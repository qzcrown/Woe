
jest.mock('file-type',()=>({fileTypeFromBuffer:jest.fn()}),{virtual:true})
jest.mock('../../src/services/migrationRunner.ts',()=>({MigrationRunner:class {async runPendingMigrations():Promise<void>{}}}))
import worker from '../../src/index.ts'
import app from '../../src/app.ts'
import type {Env} from '../../src/types/index.ts'
import {MessageHandlers} from '../../src/handlers/messageHandlers.ts'
import {createPluginJobRuntime} from '../../src/services/pluginJobs/pluginJobService.ts'
import {applications,clients,pluginConfigs,pluginJobs} from '../../src/models/index.ts'
import {createPluginJobsTestDb} from '../helpers/pluginJobsTestDb.ts'
import {asDrizzle} from '../helpers/testDb.ts'
import {makeD1Sqlite} from '../helpers/d1Sqlite.ts'
import {makeExecutionCtxStub} from '../helpers/executionContext.ts'

test('message.create -> webhook snapshot -> Worker queue -> success -> authenticated history; manual POST stays 409',async()=>{
  const db=createPluginJobsTestDb()
  db.sqlite.prepare('INSERT INTO users (id,name,admin,disabled) VALUES (7,?,1,0)').run('probe')
  db.db.insert(applications).values({id:1,userId:7,token:'Aprobe',name:'Probe'}).run()
  db.db.insert(clients).values({id:5,userId:7,token:'Cprobe',name:'Probe',platform:'web',lastUsed:new Date().toISOString(),expiresAfterInactivitySeconds:0}).run()
  const [plugin]=db.db.insert(pluginConfigs).values({userId:7,name:'Webhooker',token:'Pprobe',modulePath:'builtin/webhooker',enabled:1,configYaml:'targetUrl: https://hooks.example.com/hook\n'}).returning().all()
  const sent:Array<{jobId:number}>=[]
  const send=jest.fn(async(body:{jobId:number})=>{sent.push(body)})
  const env={DB:makeD1Sqlite(db),PLUGIN_JOB_QUEUE:{send}} as unknown as Env
  const ctx=makeExecutionCtxStub()
  const runtime=createPluginJobRuntime({drizzle:asDrizzle(db),env})
  const handlers=new MessageHandlers(asDrizzle(db),undefined,runtime)
  const fetchSpy=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response('OK',{status:200}))
  try {
    const response=await handlers.createMessage(1,'hello','Probe')
    expect(response.status).toBe(200)
    const created=await response.json() as {id:number}
    const [pending]=db.db.select().from(pluginJobs).all()
    expect(pending).toMatchObject({pluginId:plugin.id,subjectId:created.id,status:'pending'})
    expect(sent).toEqual([{jobId:pending.id}])
    const manual=await app.fetch(new Request('http://localhost/message/'+created.id+'/jobs',{method:'POST',headers:{'x-gotify-key':'Cprobe','content-type':'application/json'},body:JSON.stringify({pluginId:plugin.id})}),env as never,ctx)
    expect(manual.status).toBe(409)
    expect(send).toHaveBeenCalledTimes(1)
    const ack=jest.fn(),retry=jest.fn()
    await worker.queue({queue:'woe-plugin-jobs',messages:[{id:'probe',body:{jobId:pending.id},attempts:1,ack,retry}],ackAll:jest.fn(),retryAll:jest.fn()} as unknown as MessageBatch<unknown>,env,ctx)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [done]=db.db.select().from(pluginJobs).all()
    expect(done.status).toBe('success')
    expect(JSON.parse(done.result!)).toEqual({status:'sent',httpStatus:200})
    const history=await app.fetch(new Request('http://localhost/message/'+created.id+'/jobs?pluginId='+plugin.id,{headers:{'x-gotify-key':'Cprobe'}}),env as never,ctx)
    expect(history.status).toBe(200)
    const body=await history.json() as {jobs:Array<Record<string,unknown>>}
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0]).toMatchObject({jobId:pending.id,status:'success',error:null})
    expect(body.jobs[0]).not.toHaveProperty('payload')
    expect(body.jobs[0]).not.toHaveProperty('userId')
  } finally {fetchSpy.mockRestore();db.sqlite.close()}
})

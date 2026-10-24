















import { parseMessageCreateRequest } from "../../src/utils/messageRequestBinding";

async function readError(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

function makeRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}
): Request {
  return new Request(url, { method: init.method ?? "POST", headers: init.headers, body: init.body });
}

describe("parseMessageCreateRequest — Content-Type 分派（gin binding.Default 蒸馏）", () => {
  test("application/json; charset=utf-8 => JSON 路径", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ message: "hi" }),
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ message: "hi" });
  });

  test("application/x-www-form-urlencoded; charset=UTF-8 => form 路径", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: "message=hi",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message).toBe("hi");
  });

  test("multipart/form-data; boundary=…; charset=utf-8 => multipart 路径（参数识别）", async () => {
    const boundary = "woeboundary";
    const raw =
      `--${boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\nhi\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="priority"\r\n\r\n2\r\n` +
      `--${boundary}--\r\n`;
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": `multipart/form-data; boundary=${boundary}; charset=utf-8` },
        body: raw,
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ message: "hi", priority: 2 });
  });

  test("multipart 缺 boundary 参数 => 400", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "multipart/form-data" },
        body: "--x--",
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await readError(result.response);
      expect(body).toMatchObject({ error: "Bad Request", errorCode: 400 });
    }
  });

  test("未知 Content-Type（text/plain）：body 不强行解析，query 仍可绑定（form 默认路径）", async () => {
    const onlyBody = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "text/plain" },
        body: "message=body&title=T",
      })
    );
    expect(onlyBody.ok).toBe(true);
    if (onlyBody.ok) expect(onlyBody.data).toEqual({});

    const withQuery = await parseMessageCreateRequest(
      makeRequest("http://localhost/?message=hi&title=T", {
        headers: { "content-type": "text/plain" },
        body: "message=body",
      })
    );
    expect(withQuery.ok).toBe(true);
    if (withQuery.ok) expect(withQuery.data).toEqual({ message: "hi", title: "T" });
  });

  test("完全缺失 Content-Type：只读 query（query-only 推送脚本形态）", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/?message=hi&title=T&priority=2&appid=9&extras=%7B%22a%22%3A1%7D", {
        body: "",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.message).toBe("hi");
      expect(result.data.title).toBe("T");
      expect(result.data.priority).toBe(2);
      expect(result.data.appid).toBe(9);
      expect(result.data.extras).toEqual({ a: 1 });
    }
  });
});

describe("parseMessageCreateRequest — JSON 只绑 body", () => {
  test("JSON body 优先，query 消息字段不合并", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/?message=query&title=Q&priority=3&appid=9&extras=%7B%22a%22%3A1%7D", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "body" }),
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ message: "body" });
  });

  test("JSON 缺 message 不因 query message 而补齐", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/?message=query", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message).toBeUndefined();
  });

  test("JSON 非法体 => 400 Invalid JSON body", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/json" },
        body: "{not-json",
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(readError(result.response)).resolves.toEqual({
        error: "Bad Request",
        errorCode: 400,
        errorDescription: "Invalid JSON body",
      });
    }
  });
});

describe("parseMessageCreateRequest — urlencoded：body 首值优先，query 补缺", () => {
  test("body=message=body、query=message=query&title=T => message=body / title=T", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/?message=query&title=T", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=body",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ message: "body", title: "T" });
  });

  test("重复文本字段取首值（body 与 query 内部各自取首值）", async () => {
    const body = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=first&message=second&title=a&title=b",
      })
    );
    expect(body.ok).toBe(true);
    if (body.ok) expect(body.data).toEqual({ message: "first", title: "a" });

    const query = await parseMessageCreateRequest(
      makeRequest("http://localhost/?message=q1&message=q2", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      })
    );
    expect(query.ok).toBe(true);
    if (query.ok) expect(query.data.message).toBe("q1");
  });

  test("body 显式空值不回退 query（空串保留原样）", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/?message=query&title=Q", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=&title=",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ message: "", title: "" });
  });

  test("priority：省略 => undefined；空串 => 显式 0；2 => 2", async () => {
    const omitted = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hi",
      })
    );
    expect(omitted.ok).toBe(true);
    if (omitted.ok) expect(omitted.data.priority).toBeUndefined();

    const empty = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hi&priority=",
      })
    );
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.data.priority).toBe(0);

    const two = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hi&priority=2",
      })
    );
    expect(two.ok).toBe(true);
    if (two.ok) expect(two.data.priority).toBe(2);
  });

  test("priority 非整数（abc / 2.5 / 空白）=> 400 priority must be an integer", async () => {
    for (const priority of ["abc", "2.5", "%20"]) {
      const body = priority === "%20" ? "message=hi&priority=%20" : `message=hi&priority=${priority}`;
      const result = await parseMessageCreateRequest(
        makeRequest("http://localhost/", {
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        await expect(readError(result.response)).resolves.toEqual({
          error: "Bad Request",
          errorCode: 400,
          errorDescription: "priority must be an integer",
        });
      }
    }
  });

  test("appid：合法整数绑定；空串视为缺省；非法 => 400", async () => {
    const ok = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hi&appid=9",
      })
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.appid).toBe(9);

    const empty = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hi&appid=",
      })
    );
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.data.appid).toBeUndefined();

    const bad = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hi&appid=xyz",
      })
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.response.status).toBe(400);
      await expect(readError(bad.response)).resolves.toEqual({
        error: "Bad Request",
        errorCode: 400,
        errorDescription: "appid must be an integer",
      });
    }
  });

  test("extras：JSON 字符串解析为对象（Woe 扩展）；非法 JSON => 400", async () => {
    const ok = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `message=hi&extras=${encodeURIComponent('{"a":1}')}`,
      })
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.extras).toEqual({ a: 1 });

    const bad = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `message=hi&extras=${encodeURIComponent("{not-valid-json")}`,
      })
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.response.status).toBe(400);
      await expect(readError(bad.response)).resolves.toEqual({
        error: "Bad Request",
        errorCode: 400,
        errorDescription: "extras must be valid JSON",
      });
    }
  });

  test("extras=（显式空值）回退缺省：form 路径不设置 extras 字段", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hi&extras=",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect("extras" in result.data).toBe(false);
  });

  test("extras=（显式空值）回退缺省：query 路径同样不设置", async () => {
    const result = await parseMessageCreateRequest(makeRequest("http://localhost/?message=hi&extras="));
    expect(result.ok).toBe(true);
    if (result.ok) expect("extras" in result.data).toBe(false);
  });

  test("混合序：body 与 query 多字段交叉时 body 首值全胜，query 仅补缺字段", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/?message=query&title=T&priority=9&appid=5", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=body&priority=2",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ message: "body", title: "T", priority: 2, appid: 5 });
    }
  });
});

describe("parseMessageCreateRequest — multipart：只绑文本字段，不合并 query", () => {
  function makeMultipart(fields: Record<string, string>, url = "http://localhost/"): Request {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    return makeRequest(url, { body: form });
  }

  test("文本 message/title/priority => 绑定成功", async () => {
    const result = await parseMessageCreateRequest(
      makeMultipart({ message: "hi", title: "T", priority: "2" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ message: "hi", title: "T", priority: 2 });
  });

  test("multipart 有文本 message 则成功；只有 query message 时不并入（=> 无 message）", async () => {
    const withText = await parseMessageCreateRequest(
      makeMultipart({ message: "from-multipart" }, "http://localhost/?message=from-query")
    );
    expect(withText.ok).toBe(true);
    if (withText.ok) expect(withText.data.message).toBe("from-multipart");

    const queryOnly = await parseMessageCreateRequest(
      makeMultipart({ title: "T" }, "http://localhost/?message=from-query")
    );
    expect(queryOnly.ok).toBe(true);
    if (queryOnly.ok) expect(queryOnly.data.message).toBeUndefined();
  });

  test("重复文本字段取首值", async () => {
    const form = new FormData();
    form.append("message", "first");
    form.append("message", "second");
    const result = await parseMessageCreateRequest(makeRequest("http://localhost/", { body: form }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message).toBe("first");
  });

  test("与消息字段同名的 File 部件不可当字符串 => 绑定失败 400", async () => {
    const form = new FormData();
    form.append("message", new Blob(["file-content"]), "payload.txt");
    const result = await parseMessageCreateRequest(makeRequest("http://localhost/", { body: form }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await readError(result.response);
      expect(body).toMatchObject({ error: "Bad Request", errorCode: 400 });
      expect(String(body.errorDescription)).toContain("message");
    }
  });

  test("无关文件字段忽略（不进入绑定结果、不持久化）", async () => {
    const form = new FormData();
    form.append("message", "hi");
    form.append("attachment", new Blob(["irrelevant"]), "note.txt");
    const result = await parseMessageCreateRequest(makeRequest("http://localhost/", { body: form }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ message: "hi" });
  });

  test("extras / appid / priority 走与 form 相同的字段转换（Woe extras JSON 扩展保持）", async () => {
    const ok = await parseMessageCreateRequest(
      makeMultipart({
        message: "hi",
        extras: '{"a":1}',
        appid: "9",
        priority: "",
      })
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.extras).toEqual({ a: 1 });
      expect(ok.data.appid).toBe(9);
      expect(ok.data.priority).toBe(0);
    }

    const badExtras = await parseMessageCreateRequest(makeMultipart({ message: "hi", extras: "{bad" }));
    expect(badExtras.ok).toBe(false);
    if (!badExtras.ok) {
      expect(badExtras.response.status).toBe(400);
      await expect(readError(badExtras.response)).resolves.toEqual({
        error: "Bad Request",
        errorCode: 400,
        errorDescription: "extras must be valid JSON",
      });
    }
  });

  test("multipart 体与 boundary 不匹配 => 400", async () => {
    const result = await parseMessageCreateRequest(
      makeRequest("http://localhost/", {
        headers: { "content-type": "multipart/form-data; boundary=declared" },
        body: "--other\r\n\r\nx\r\n--other--\r\n",
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});

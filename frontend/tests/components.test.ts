import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import EmptyState from '@/components/EmptyState.vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import ConnectionStatus from '@/components/ConnectionStatus.vue'

describe('LoadingSpinner', () => {
  it('renders correctly with default props', () => {
    const wrapper = mount(LoadingSpinner)
    expect(wrapper.find('.loading-spinner').exists()).toBe(true)
    expect(wrapper.find('.spinner-circle').exists()).toBe(true)
  })

  it('renders with custom text', () => {
    const wrapper = mount(LoadingSpinner, {
      props: { text: 'Custom loading text' }
    })
    expect(wrapper.text()).toContain('Custom loading text')
  })

  it('renders different variants', () => {
    const wrapper = mount(LoadingSpinner, {
      props: { variant: 'dots' }
    })
    expect(wrapper.find('.spinner-dots').exists()).toBe(true)
    expect(wrapper.find('.spinner-circle').exists()).toBe(false)
  })
})

describe('EmptyState', () => {
  it('renders correctly with default props', () => {
    const wrapper = mount(EmptyState)
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('No data available')
  })

  it('renders with custom title and description', () => {
    const wrapper = mount(EmptyState, {
      props: {
        title: 'Custom Title',
        description: 'Custom description'
      }
    })
    expect(wrapper.text()).toContain('Custom Title')
    expect(wrapper.text()).toContain('Custom description')
  })

  it('renders different types', () => {
    const wrapper = mount(EmptyState, {
      props: { type: 'messages' }
    })
    expect(wrapper.find('.empty-state').exists()).toBe(true)
  })
})

describe('ApplicationIcon', () => {
  it('renders placeholder when no image provided', () => {
    const wrapper = mount(ApplicationIcon, {
      props: {
        name: 'Test App'
      }
    })
    expect(wrapper.find('.icon-placeholder').exists()).toBe(true)
    expect(wrapper.find('.icon-image').exists()).toBe(false)
  })

  it('renders image when provided', () => {
    const wrapper = mount(ApplicationIcon, {
      props: {
        name: 'Test App',
        image: 'test-image.jpg'
      }
    })
    expect(wrapper.find('.icon-image').exists()).toBe(true)
    expect(wrapper.find('.icon-placeholder').exists()).toBe(false)
  })

  it('shows upload overlay when enabled', () => {
    const wrapper = mount(ApplicationIcon, {
      props: {
        name: 'Test App',
        showUploadOverlay: true
      }
    })
    expect(wrapper.find('.upload-overlay').exists()).toBe(true)
  })
})

describe('ConnectionStatus', () => {
  it('renders disconnected state by default', () => {
    const wrapper = mount(ConnectionStatus, {
      props: {
        connected: false
      }
    })
    expect(wrapper.text()).toContain('Disconnected')
    expect(wrapper.find('.status-disconnected').exists()).toBe(true)
  })

  it('renders connected state', () => {
    const wrapper = mount(ConnectionStatus, {
      props: {
        connected: true
      }
    })
    expect(wrapper.text()).toContain('Connected')
    expect(wrapper.find('.status-connected').exists()).toBe(true)
  })

  it('renders connecting state', () => {
    const wrapper = mount(ConnectionStatus, {
      props: {
        connected: false,
        connecting: true
      }
    })
    expect(wrapper.text()).toContain('Connecting...')
    expect(wrapper.find('.status-connecting').exists()).toBe(true)
  })
})
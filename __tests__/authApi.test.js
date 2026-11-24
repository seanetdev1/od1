import logout from 'functions/logout'

jest.mock('js-cookie', () => ({
  get: jest.fn(),
  remove: jest.fn(),
}))
jest.mock('functions/setAccesLevels', () => ({ setTempToken: jest.fn() }))
jest.mock('next/router', () => ({ push: jest.fn() }))
// logout reports failure through antd notifications, not alert(). A native
// alert blocks the tab and cannot say which of several failures happened.
jest.mock('antd', () => ({ notification: { error: jest.fn(), success: jest.fn() } }))

const Cookies = require('js-cookie')
const Router = require('next/router')
const { setTempToken } = require('functions/setAccesLevels')
const { notification } = require('antd')

describe('logout function', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
    Cookies.get.mockReturnValue('token-value')
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  test('successful logout sends the token and clears session', async () => {
    global.fetch.mockResolvedValue({ ok: true })

    await logout()

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/authRoutes/logout'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'token-value' }),
      })
    )
    expect(Cookies.remove).toHaveBeenCalledTimes(5)
    expect(Cookies.remove).toHaveBeenCalledWith('token')
    expect(Cookies.remove).toHaveBeenCalledWith('username')
    expect(Cookies.remove).toHaveBeenCalledWith('companyId')
    expect(Cookies.remove).toHaveBeenCalledWith('designation')
    expect(Cookies.remove).toHaveBeenCalledWith('loginId')
    expect(setTempToken).toHaveBeenCalledWith(null, true)
    expect(Router.push).toHaveBeenCalledWith('/login')
  })

  test('failed logout shows the server error and does not clear session', async () => {
    global.fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'err' }) })

    await logout()

    expect(notification.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Logout failed', description: 'err' })
    )
    // The session must survive a rejected logout. Clearing the cookies anyway
    // would leave the user looking logged out while the server-side session
    // stayed valid until it expired on its own.
    expect(Cookies.remove).not.toHaveBeenCalled()
    expect(setTempToken).not.toHaveBeenCalled()
    expect(Router.push).not.toHaveBeenCalled()
  })

  test('failed logout falls back to a generic message when the server sends none', async () => {
    global.fetch.mockResolvedValue({ ok: false, json: async () => ({}) })

    await logout()

    expect(notification.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Logout failed',
        description: 'The server rejected the logout request.',
      })
    )
  })

  test('an unreachable server is reported as such, and keeps the session', async () => {
    // Distinct from a rejection: nothing reached the server, so retrying is
    // the right advice rather than "the server said no".
    global.fetch.mockRejectedValue(new Error('network down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await logout()

    expect(notification.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Cannot reach the server' })
    )
    expect(Cookies.remove).not.toHaveBeenCalled()
    expect(Router.push).not.toHaveBeenCalled()

    console.error.mockRestore()
  })
})
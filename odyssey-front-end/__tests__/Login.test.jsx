import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('apis/axiosClient', () => ({ post: jest.fn(), get: jest.fn() }))
// The install badge no longer fetches /health itself - it reads
// getInstallInfo(), the one memoised call the browser tab's name also uses, so
// the two can never disagree about which install this is. Mocked at THAT
// boundary rather than at the transport: memoisation means a second render
// would not re-request, so mocking axios would leave each case here depending
// on the order the others ran in.
jest.mock('functions/installInfo', () => ({ getInstallInfo: jest.fn() }))
jest.mock('js-cookie', () => ({ set: jest.fn() }))
jest.mock('next/router', () => ({ push: jest.fn() }))
jest.mock('jwt-decode', () => jest.fn())

const axiosClient = require('apis/axiosClient')
const { getInstallInfo } = require('functions/installInfo')
const Cookies = require('js-cookie')
const Router = require('next/router')
const jwt_decode = require('jwt-decode')

import Login from '../Components/Layouts/Login'

describe('Login component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // A quiet default for the tests that are not about the badge. Resolving
    // with no installId means the component's state never changes from '', so
    // React bails out of the re-render and nothing escapes act().
    getInstallInfo.mockResolvedValue({})
  })

  test('successful login sets cookies and redirects', async () => {
    axiosClient.post.mockResolvedValue({ data: { message: 'Success', token: 'fake.jwt' } })
    jwt_decode.mockReturnValue({ designation: 'Dev', username: 'tester', id: 123 })

    render(<Login sessionData={{ isLoggedIn: false }} />)

    fireEvent.change(screen.getByPlaceholderText('Enter your username...'), { target: { value: 'u' } })
    fireEvent.change(screen.getByPlaceholderText('Enter your password...'), { target: { value: 'p' } })

    fireEvent.click(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => expect(Cookies.set).toHaveBeenCalledWith('token', 'fake.jwt', { expires: 1 }))
    expect(Cookies.set).toHaveBeenCalledWith('designation', 'Dev', { expires: 1 })
    expect(Cookies.set).toHaveBeenCalledWith('username', 'tester', { expires: 1 })
    expect(Cookies.set).toHaveBeenCalledWith('loginId', 123, { expires: 1 })
    expect(Router.push).toHaveBeenCalledWith('/')
  })

  test('invalid credentials shows error message', async () => {
    axiosClient.post.mockResolvedValue({ data: { message: 'Invalid' } })

    render(<Login sessionData={{ isLoggedIn: false }} />)

    fireEvent.change(screen.getByPlaceholderText('Enter your username...'), { target: { value: 'u' } })
    fireEvent.change(screen.getByPlaceholderText('Enter your password...'), { target: { value: 'p' } })

    fireEvent.click(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => expect(screen.getByText('Wrong username or password')).toBeInTheDocument())
  })

  test('force login flow shows modal on 409 response', async () => {
    axiosClient.post.mockRejectedValue({ response: { status: 409 } })

    render(<Login sessionData={{ isLoggedIn: false }} />)

    fireEvent.change(screen.getByPlaceholderText('Enter your username...'), { target: { value: 'u' } })
    fireEvent.change(screen.getByPlaceholderText('Enter your password...'), { target: { value: 'p' } })

    fireEvent.click(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => expect(screen.getByText('User Already Logged In')).toBeInTheDocument())
  })

  // Seanet support: a credential from the licence server instead of a password.
  test('support sign-in posts the credential to systemLogin and signs in', async () => {
    axiosClient.post.mockResolvedValue({ data: { message: 'Success', token: 'BearerSplitsupport.jwt' } })
    jwt_decode.mockReturnValue({ designation: 'admin', username: 'Seanet Support (Bilal)', id: 'u1', system: true })

    render(<Login sessionData={{ isLoggedIn: false }} />)
    fireEvent.click(screen.getByText('Seanet support sign-in'))
    fireEvent.change(screen.getByPlaceholderText(/support credential/i), { target: { value: '  ods1.abc.def \n' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(Router.push).toHaveBeenCalledWith('/'))
    expect(axiosClient.post).toHaveBeenCalledWith(expect.stringMatching(/\/authRoutes\/systemLogin$/), { credential: 'ods1.abc.def' })
    expect(Cookies.set).toHaveBeenCalledWith('token', 'BearerSplitsupport.jwt', { expires: 1 })
    expect(Cookies.set).toHaveBeenCalledWith('designation', 'admin', { expires: 1 })
  })

  test('a rejected support credential shows the server\'s reason', async () => {
    axiosClient.post.mockRejectedValue({ response: { status: 401, data: { message: 'Support credential rejected: credential has expired.' } } })

    render(<Login sessionData={{ isLoggedIn: false }} />)
    fireEvent.click(screen.getByText('Seanet support sign-in'))
    fireEvent.change(screen.getByPlaceholderText(/support credential/i), { target: { value: 'ods1.old.one' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getByText('Support credential rejected: credential has expired.')).toBeInTheDocument())
    expect(Router.push).not.toHaveBeenCalled()
  })
})

/**
 * The install badge.
 *
 * Several instances of Odyssey run on the same network and their login screens
 * are otherwise identical, so the badge is what stops someone typing customer
 * A's credentials into customer B's box.
 *
 * It has to come from /health because this screen is pre-auth - the cookies
 * that identify an installation everywhere else in the app (operationMode,
 * companyId) are only set once a login succeeds.
 */
describe('Login install badge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getInstallInfo.mockResolvedValue({})
  })

  test('shows the installId reported by /health', async () => {
    getInstallInfo.mockResolvedValue({ status: 'ok', version: '1.1.5', installId: 'odyssey-IFA' })

    render(<Login sessionData={{ isLoggedIn: false }} />)

    await waitFor(() => expect(screen.getByText('odyssey-IFA')).toBeInTheDocument())
    expect(getInstallInfo).toHaveBeenCalled()
  })

  test('two installs on one network are told apart', async () => {
    // The whole point of the badge. Same build, same screen, different box.
    getInstallInfo.mockResolvedValue({ installId: 'odyssey-CL' })

    render(<Login sessionData={{ isLoggedIn: false }} />)

    await waitFor(() => expect(screen.getByText('odyssey-CL')).toBeInTheDocument())
    expect(screen.queryByText('odyssey-IFA')).not.toBeInTheDocument()
  })

  test('a failing /health leaves the login screen usable and unmarked', async () => {
    // A backend that is down must not turn the login page into an error page:
    // it is the one screen where the user has no way to act on the message.
    //
    // getInstallInfo RESOLVES NULL rather than rejecting - swallowing the
    // failure is its job now, and that contract is what lets this component
    // read it without a catch of its own.
    getInstallInfo.mockResolvedValue(null)

    render(<Login sessionData={{ isLoggedIn: false }} />)

    await waitFor(() => expect(getInstallInfo).toHaveBeenCalled())
    expect(screen.getByPlaceholderText('Enter your username...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument()
  })

  test('an older build whose /health has no installId renders no badge', async () => {
    // /health predates installId on some builds, and INSTALL_NAME-less
    // installs can report null. Neither should print "null" on the screen -
    // nor should an unreachable backend, which arrives here as null.
    for (const info of [{}, { installId: null }, { installId: '' }, null]) {
      getInstallInfo.mockResolvedValue(info)
      const { unmount } = render(<Login sessionData={{ isLoggedIn: false }} />)
      await waitFor(() => expect(getInstallInfo).toHaveBeenCalled())
      expect(screen.queryByText('null')).not.toBeInTheDocument()
      unmount()
    }
  })

  test('logging in still works when /health failed', async () => {
    // The badge is cosmetic; it must not sit in the way of the actual job.
    getInstallInfo.mockResolvedValue(null)
    axiosClient.post.mockResolvedValue({ data: { message: 'Success', token: 'fake.jwt' } })
    jwt_decode.mockReturnValue({ designation: 'Dev', username: 'tester', id: 123 })

    render(<Login sessionData={{ isLoggedIn: false }} />)

    fireEvent.change(screen.getByPlaceholderText('Enter your username...'), { target: { value: 'u' } })
    fireEvent.change(screen.getByPlaceholderText('Enter your password...'), { target: { value: 'p' } })
    fireEvent.click(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => expect(Router.push).toHaveBeenCalledWith('/'))
  })
})

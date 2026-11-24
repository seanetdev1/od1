import Router from "next/router";
import Cookies from "js-cookie";
import { notification } from "antd";
import { setTempToken } from "./setAccesLevels";

// Clears the server-side session first, then the client-side cookies, then
// redirects. The server call matters: sessions live in the database now
// (Odyssey-Backend-Server/functions/sessionManager.js), so dropping cookies
// alone would leave the token valid until it expired on its own.
async function logout() {
  try {
    const token = Cookies.get('token');
    const response = await fetch(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/authRoutes/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
    });

    if (response.ok) {
      Cookies.remove('token');
      setTempToken(null, true);
      Cookies.remove("username");
      Cookies.remove("companyId");
      Cookies.remove("designation");
      Cookies.remove("loginId");
      Router.push('/login');
    } else {
      const body = await response.json();
      notification.error({
        key: 'logout-failed',
        message: 'Logout failed',
        description: body.message || 'The server rejected the logout request.',
        duration: 6,
      });
    }
  } catch (err) {
    console.error('Logout request failed:', err);
    notification.error({
      key: 'logout-unreachable',
      message: 'Cannot reach the server',
      description: 'Check your connection and try again.',
      duration: 6,
    });
  }
}

export default logout

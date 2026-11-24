import { notification } from "antd";
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { store } from 'redux/store';
import { addNotification } from 'redux/notifications/notificationSlice';

// WHAT THE HEADER BELL KEEPS: errors and warnings only (the user, 2026-11-23).
// A "Saved" or "Deleted" toast has done its job once it is seen, and a
// session's worth of them buried the one failure worth going back to. Every
// caller colours a toast by what it is - red an error, orange a warning or a
// partial result - so the colour decides; green and blue are shown and not
// kept. Case-insensitive: a few callers pass 'Orange' / 'Red'.
const KEPT_COLORS = ['red', 'orange'];
export const keptInBell = (color) => KEPT_COLORS.includes(String(color ?? '').trim().toLowerCase());

// `duration` is optional and defaults to the original 4s, so existing three-
// argument callers are unaffected. Pass a longer value for messages that
// explain what went wrong and what to do about it - those take more than
// four seconds to read, and the toast vanishing mid-sentence is why users
// end up reporting "it just failed" with no detail.
const openNotification = (title, message, color, duration = 4) => {
    notification.open({
      message: title,
      description: message,
      icon: <ExclamationCircleOutlined style={{ color: color }} />,
      onClick: () => {
        // console.log('Notification Clicked!');
      },
      duration: duration
    });

    // Also record it in redux so the header bell can show it after the 4s
    // toast disappears - an error or a warning only, see keptInBell above.
    // Best-effort, and only stores serializable strings (a few call sites may
    // pass a React node as message - fall back to '' then). Never let this
    // throw in a UI handler.
    if (!keptInBell(color)) return;
    try {
      store.dispatch(addNotification({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: typeof title === 'string' ? title : String(title ?? ''),
        message: typeof message === 'string' ? message : '',
        color: color || '',
        time: new Date().toISOString(),
      }));
    } catch (_) {
      /* ignore */
    }
};

export default openNotification
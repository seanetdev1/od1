import React from 'react';
import { Modal } from 'antd';
import { ExclamationCircleFilled, DeleteOutlined } from '@ant-design/icons';

const { confirm } = Modal;

/**
 * Ask before doing something that cannot be taken back.
 *
 * PopConfirm(title, content, onOk) is how eight screens already call this and
 * that signature is unchanged. The fourth argument is new and optional: what
 * the buttons say, and whether the confirming one is a destructive red.
 *
 * THE WAIT IS THE REFINEMENT. `onOk` used to be called and forgotten, so the
 * dialog closed instantly and the row it was asking about carried on existing
 * for another second - which reads as a delete that did not work, and invites
 * a second press. It is awaited now: antd keeps the dialog up with a spinner
 * on the button until the work finishes, so the screen that reappears is the
 * screen after the change.
 */
function PopConfirm(popTitle, popContent, onOkClick, options = {}) {
  confirm({
    title: `${popTitle}`,
    content: `${popContent}`,
    icon: options.danger ? <DeleteOutlined style={{ color: '#a3282a' }} /> : <ExclamationCircleFilled />,
    okText: options.okText || 'OK',
    cancelText: options.cancelText || 'Cancel',
    // The confirming button carries the weight of what it does. A red OK is
    // the one thing a person reads before pressing it out of habit.
    okButtonProps: { danger: Boolean(options.danger) },
    // Escape and the mask close it, because the safe answer should be the
    // easy one; only the button says yes.
    maskClosable: true,
    async onOk() {
      try {
        await onOkClick();
      } catch (e) {
        // Swallowed exactly as before - the caller reports its own failures,
        // and a rejected promise here would leave antd's dialog open with a
        // spinner and no way out.
        console.error('Confirmed action failed:', e);
      }
    },
    onCancel() {},
  });
}

/**
 * The same question, asked about a deletion.
 *
 * Preset rather than left to each caller: "Delete" on the button instead of
 * "OK" says what is about to happen, and every screen that deletes should ask
 * it the same way. Pass `name` and the thing is named in the question, because
 * "Delete this?" is a different question from "Delete A330?".
 */
export function confirmDelete({ what = 'this', name, body, okText, onOk }) {
  const subject = name ? `${what} ${name}` : what;
  PopConfirm(
    `Delete ${subject}?`,
    body || 'This cannot be undone.',
    onOk,
    { danger: true, okText: okText || 'Delete' },
  );
}

export default PopConfirm;

import React, { useState } from 'react';
import { Modal, Form, Input, notification } from 'antd';
import axiosClient from 'apis/axiosClient';
import { isSystemSession } from 'functions/systemSession';

/**
 * Who is signed in - their initials and name - which opens Change Password.
 * At the foot of the sidebar since 2026-11-23 (variant 'sider'; collapsed, the
 * initials alone); it was the header's user chip.
 *
 * Users are created by Seanet on a leased install, so whoever set an account
 * up knows its first password. This is how its owner makes it theirs.
 * A Seanet support session has no password (it signs in with a credential),
 * so for one the name is just a label.
 */
const ChangePassword = ({ username, variant = 'header', collapsed = false }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const isSupport = isSystemSession() && String(username || '').startsWith('Seanet Support');

  const close = () => { setOpen(false); form.resetFields(); };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/authRoutes/changePassword`, {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      notification.success({ message: 'Password changed' });
      close();
    } catch (err) {
      notification.error({
        message: 'Password not changed',
        description: err?.response?.data?.message || 'The server could not change it.',
      });
    } finally {
      setSaving(false);
    }
  };

  // Who is signed in: their initials in a circle, then the name.
  const initials = String(username || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const sider = variant === 'sider';
  const cls = sider ? 'sider-user' : 'hdr-user';
  const label = sider ? (
    <>
      <span className='sider-avatar' aria-hidden='true'>{initials}</span>
      {!collapsed && (
        <span className='sider-user-text'>
          <span className='sider-user-name'>{username}</span>
          {!isSupport && <span className='sider-user-hint'>Change password</span>}
        </span>
      )}
    </>
  ) : <><span className='hdr-avatar' aria-hidden='true'>{initials}</span><span className='hdr-user-name'>{username}</span></>;
  if (isSupport) {
    return <span className={cls} title={`Signed in as ${username}`}>{label}</span>;
  }

  return (
    <>
      <button type='button' className={`${cls} ${cls}-link`} title={`Signed in as ${username} - click to change your password`}
        onClick={() => setOpen(true)}>{label}</button>
      <Modal title='Change password' open={open} onOk={save} onCancel={close} okText='Change' confirmLoading={saving} destroyOnClose>
        <Form form={form} layout='vertical' preserve={false}>
          <Form.Item name='currentPassword' label='Current password' rules={[{ required: true, message: 'Required' }]}>
            <Input.Password autoComplete='current-password' />
          </Form.Item>
          <Form.Item name='newPassword' label='New password'
            rules={[{ required: true, message: 'Required' }, { min: 8, message: 'At least 8 characters' }]}>
            <Input.Password autoComplete='new-password' />
          </Form.Item>
          <Form.Item name='confirm' label='New password again' dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Required' },
              ({ getFieldValue }) => ({
                validator: (_, v) => (!v || v === getFieldValue('newPassword')
                  ? Promise.resolve()
                  : Promise.reject(new Error('Does not match'))),
              }),
            ]}>
            <Input.Password autoComplete='new-password' />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default ChangePassword;

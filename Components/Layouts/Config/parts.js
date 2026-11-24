import React from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

// The pieces every Configuration section is built from, so the sections read
// as one screen rather than sixteen.
//
// EXPLANATIONS SIT BEHIND A HOVER. Each setting used to carry its paragraph
// on the page, and the screen read as a wall of grey text with the controls
// lost in it (the user's request, 2026-10-17). The text is kept behind an (i)
// beside what it explains - and as the icon's aria-label, so a screen reader
// still reads it out and a test can still find it. Warnings - a permanent
// choice, mail that will not send - stay on the page.

/** An (i) that shows `text` on hover or keyboard focus. */
export const Hint = ({ text, placement = 'top' }) => (
  <Tooltip title={text} placement={placement} overlayStyle={{ maxWidth: 380 }}>
    <span role='img' tabIndex={0} aria-label={text} style={hintStyle}>
      <InfoCircleOutlined />
    </span>
  </Tooltip>
);

/** A section's card: a title, its hint, anything for the right of the title. */
export const Section = ({ title, hint, extra, children, style, ...rest }) => (
  <section style={{ ...cardStyle, ...style }} {...rest}>
    {(title || extra) && (
      <div style={headStyle}>
        {title && <h5 style={titleStyle}>{title}{hint && <Hint text={hint} />}</h5>}
        {extra && <div style={{ marginLeft: 'auto' }}>{extra}</div>}
      </div>
    )}
    {children}
  </section>
);

/** A sub-heading inside a section. */
export const SubHead = ({ children, hint, style }) => (
  <h6 style={{ ...subStyle, ...style }}>{children}{hint && <Hint text={hint} />}</h6>
);

/** One setting: its name (and hint) on the left, its control on the right. */
export const SettingRow = ({ label, hint, children }) => (
  <div style={rowStyle}>
    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {hint && <Hint text={hint} />}
    </div>
    <div style={{ flex: 'none' }}>{children}</div>
  </div>
);

/** A field's label above its input - the small caps every form here uses. */
export const FieldLabel = ({ children, hint }) => (
  <div style={labelStyle}>{children}{hint && <Hint text={hint} />}</div>
);

const hintStyle = {
  color: '#9aa5b1', marginLeft: 6, cursor: 'help', fontSize: 13,
  fontWeight: 400, verticalAlign: 'baseline', outline: 'none',
};
export const cardStyle = {
  background: '#fff', border: '1px solid #e9edf2', borderRadius: 8, padding: 20,
};
const headStyle = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 };
const titleStyle = { margin: 0, fontWeight: 600, fontSize: 16 };
const subStyle = {
  fontWeight: 600, fontSize: 13, color: '#4a5561', margin: '18px 0 8px',
  paddingBottom: 6, borderBottom: '1px solid #f0f2f5',
};
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0',
  borderBottom: '1px solid #f3f5f7', maxWidth: 640,
};
const labelStyle = {
  fontSize: 11, color: '#8a97a3', textTransform: 'uppercase',
  letterSpacing: '0.03em', marginBottom: 4, fontWeight: 600,
};

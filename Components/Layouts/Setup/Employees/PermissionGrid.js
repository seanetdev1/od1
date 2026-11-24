import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox, Spin } from 'antd';
import { useField } from 'formik';
import axiosClient from 'apis/axiosClient';
import { getMode } from 'functions/terminology';
import { expandNames, modulesFor, toNames, toggle, setRow } from 'functions/permissionGrid';

/**
 * What a user may do: one row per module, one box per action.
 *
 * Bound to a Formik field holding the stored access names. Drawn from the
 * server's own catalog (GET /authRoutes/permissionCatalog), so it offers
 * exactly what the server enforces and nothing else. Modules that do not
 * apply to this install's operation mode are not shown.
 */
const PermissionGrid = ({ name }) => {
  const [field, , helpers] = useField(name);
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const mode = getMode();

  useEffect(() => {
    axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/authRoutes/permissionCatalog`)
      .then(({ data }) => setCatalog(data))
      .catch(() => setError('Could not load the permission list.'));
  }, []);

  const state = useMemo(() => (catalog ? expandNames(field.value, catalog) : null), [field.value, catalog]);
  const modules = useMemo(() => modulesFor(catalog, mode), [catalog, mode]);
  const groups = useMemo(() => [...new Set(modules.map((m) => m.group))], [modules]);

  if (error) return <div className='text-danger' style={{ fontSize: 12 }}>{error}</div>;
  if (!catalog || !state) return <Spin size='small' />;

  const actionKeys = Object.keys(catalog.actions);
  const save = (next) => helpers.setValue(toNames(next, catalog, mode));

  return (
    <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
      <Checkbox checked={state.admin} onChange={(e) => save({ ...state, admin: e.target.checked })}>
        <b>Full access</b> <span className='grey-txt' style={{ fontSize: 12 }}>- every module and action</span>
      </Checkbox>
      <table style={{ width: '100%', marginTop: 8, fontSize: 12, opacity: state.admin ? 0.4 : 1 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Module</th>
            {actionKeys.map((a) => <th key={a} style={{ textAlign: 'center', whiteSpace: 'nowrap', padding: '0 6px' }}>{catalog.actions[a]}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g}>
              <tr><td colSpan={actionKeys.length + 1} style={{ paddingTop: 8, fontWeight: 700 }}>{g}</td></tr>
              {modules.filter((m) => m.group === g).map((m) => {
                const all = m.actions.every((a) => state.perms.has(`${m.key}:${a}`));
                return (
                  <tr key={m.key}>
                    <td>
                      <Checkbox checked={all} disabled={state.admin}
                        onChange={(e) => save({ ...state, perms: setRow(state.perms, m, e.target.checked) })}>
                        {m.label}
                      </Checkbox>
                    </td>
                    {actionKeys.map((a) => (
                      <td key={a} style={{ textAlign: 'center' }}>
                        {m.actions.includes(a) && (
                          <Checkbox aria-label={`${m.label} - ${catalog.actions[a]}`}
                            checked={state.perms.has(`${m.key}:${a}`)} disabled={state.admin}
                            onChange={(e) => save({ ...state, perms: toggle(state.perms, m.key, a, e.target.checked) })} />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PermissionGrid;

import React, { useReducer } from 'react';
import { Modal } from 'antd';
import PortForm from 'Components/Layouts/Setup/portOfDischarge/CreateOrEdit';

/**
 * SETUP > PORTS' OWN FORM, opened from a customs job's port heading (Essani,
 * 2026-11-14; Configuration > Customs' "Add ports from the job"). The same
 * form - same checks, same server route - in a modal, so a port missing from
 * the list is added without leaving the job, and the job then picks it.
 *
 * The form keeps its state in the Ports screen's reducer; this gives it one
 * of its own that answers the same three messages and hands back the port it
 * created (it puts the new port first on `records`).
 *
 * `loading`: added as a Port Of Loading - its "Customs port of loading" box
 * starts ticked, so it is offered there. Once any port is ticked, the ticked
 * ports are the Port Of Loading list (Setup > Ports says so beside the box).
 */
const reducer = (state, action) => {
  switch (action.type) {
    case 'toggle': return { ...state, [action.fieldName]: action.payload };
    case 'modalOff': return { ...state, visible: false };
    default: return state;
  }
};

const AddPortModal = ({ open, loading = false, onClose, onAdded }) => {
  const [state, rawDispatch] = useReducer(reducer, {
    records: [], load: false, visible: true, edit: false, selectedRecord: {}, values: {},
  });

  const dispatch = (action) => {
    // The form saved: its new port is first on the list it hands back.
    if (action.type === 'toggle' && action.fieldName === 'records') {
      const port = action.payload?.[0];
      if (port) onAdded?.(port);
    }
    if (action.type === 'modalOff') onClose?.();
    rawDispatch(action);
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={720} destroyOnClose maskClosable={false}>
      {open && (
        <PortForm
          state={state}
          dispatch={dispatch}
          baseValues={{ portId: '', portName: '', portCountry: '', customsLoading: loading }}
        />
      )}
    </Modal>
  );
};

export default AddPortModal;

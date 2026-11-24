import { Row, Col } from 'react-bootstrap';
import React from "react";
import { Form, Input, Switch, Select, notification } from 'antd';
import axiosClient from 'apis/axiosClient';
import { useSelector } from 'react-redux';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import Cookies from 'js-cookie';
import CompanyVisibility from 'Components/Shared/CompanyVisibility';

const { Option } = Select;

const CreateOrEdit = ({ state, dispatch, getAccounts, disableModal }) => {
  const companyId = useSelector((s) => s.company.value);

  const openNotification = (title, message, color) => {
    notification.open({
      message: title,
      description: message,
      icon: <ExclamationCircleOutlined style={{ color }} />,
    });
  };

  const handleSubmit = async () => {
    try {
    //   const endpoint = state.isParent
    //     ? process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_PARENT_ACCOUNT
    //     : process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_CHILD_ACCOUNT;

      const payload = {
        title: state.title,
        // editable convention: '0' = editable (shows the edit pencil), '1' = not.
        editable: state.editable ? 0 : 1,
        // The parent comes straight from the dropdown selection: a value means
        // it's a child of that account, empty means a top-level account. (We no
        // longer gate this on state.isParent, which could be stale from a prior
        // edit and silently drop the parent.)
        ChildAccountId: state.selectedParentId || null,
        subCategory: state.subCategory || "General",
        // CompanyId: companyId,
      };

      console.log("Payload for account creation:", payload);

      const { data } = await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_CHILD_ACCOUNT, payload);
      if (data.status === "success") {
        const accountRequest = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_ACCOUNTS,{
            headers:{
                "id": `${Cookies.get('companyId')}`
            }
        }).then((x)=>x.data);
        getAccounts(accountRequest);
        dispatch({ type: "toggle", fieldName: "visible", payload: false });
        disableModal();
        openNotification("Success", `Account ${state.title} Created!`, "green");
      } else {
        openNotification("Failure", `An account named "${state.title}" already exists!`, "red");
      }
    } catch (err) {
      console.error(err);
      openNotification("Error", "Something went wrong!", "red");
    }
  };

  const handleEdit = async () => {
    try {
      const endpoint = state.isParent
        ? process.env.NEXT_PUBLIC_CLIMAX_POST_EDIT_PARENT_ACCOUNT
        : process.env.NEXT_PUBLIC_CLIMAX_POST_EDIT_CHILD_ACCOUNT;

      /* PLACEMENT IS SENT ONLY WHEN IT MAY CHANGE.
       *
       * Leaving `parentId` out entirely tells the server not to touch it - see
       * /editChildAccount, where undefined and null mean different things:
       * null IS the top level, so a field omitted by accident would tear the
       * account out of the tree rather than leave it alone. This used to send
       * parseInt('') - NaN - for an account with no parent.
       *
       * A node with children may not be moved at all, so its placement is not
       * sent even as its current value: a request that cannot be honoured is
       * better not made. */
      const payload = {
        id: state.selectedRecord.id,
        title: state.selectedRecord.title,
        CompanyId: companyId,
        employeeId: Cookies.get("loginId"),
      };
      if (!state.selectedHasChildren) {
        payload.parentId = state.selectedParentId ? parseInt(state.selectedParentId) : null;
      }

      if (!state.isParent) {
        payload.ParentAccountId = state.selectedRecord.ParentAccountId;
        payload.subCategory = state.selectedRecord.subCategory || "General";
      }

      const { data } = await axiosClient.post(endpoint, payload);
      if (data.status === "success") {
        const accountRequest = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_ACCOUNTS,{
            headers:{
                "id": `${Cookies.get('companyId')}`
            }
        }).then((x)=>x.data);
        getAccounts(accountRequest);
        openNotification("Success", `Account ${state.selectedRecord.title} Updated!`, "green");
        disableModal();
      } else if (data.status === "exists") {
        openNotification("Failure", `A Similar Account With Name ${state.selectedRecord.title} Already Exists!`, "red");
      } else {
        // The server refuses a move it cannot honour and says why - a locked
        // account, a parent that has gone, a node with children. Those
        // sentences are the whole content of the failure, so they are shown
        // rather than replaced with "something went wrong".
        openNotification("Failure", data.result || "The account could not be updated.", "red");
      }
    } catch (err) {
      console.error(err);
      const said = err?.response?.data?.result;
      openNotification("Error", typeof said === 'string' ? said : "Something went wrong!", "red");
    }
  };

  const renderAccountOptions = (accounts, level = 0) => {
    return accounts.map((x) => {
        const indent = "\u00A0\u00A0".repeat(level); // adds visual indentation
        return [
        <Option key={x.id} value={x.id}>
            {indent}
            {x.code ? `${x.code} — ${x.title}` : x.title}
        </Option>,
        ...(x.children ? renderAccountOptions(x.children, level + 1) : []),
        ];
    });
  };

  console.log("Current State in CreateOrEdit:", state);

  return (
    <div className="employee-styles">
      <Form name="basic" onFinish={state.edit ? handleEdit : handleSubmit}>
        <h6>{state.edit ? "Edit Account" : "Create Account"}</h6>
        <hr />
        <Row>
          {/* PARENT ACCOUNT - where this account sits.
              
              LOCKED FOR A NODE THAT HAS CHILDREN. An account's code is
              hierarchical (parent code x 10000, see the backend's
              functions/childAccountCode), so moving an account means reissuing
              its number under the new parent. For a leaf that is one row; for
              a node it is every code beneath it, to any depth, and some of
              those are printed on statements already filed.
              
              Greyed with the reason beside it rather than hidden: an absent
              field reads as an oversight, and the question "why can I not move
              this" is exactly what the note answers. */}
          <Col md={6}>
            <Form.Item label="Parent Account">
              <Select
                showSearch
                placeholder="Select Parent Account"
                allowClear
                disabled={state.edit && state.selectedHasChildren}
                value={state.selectedParentId ? parseInt(state.selectedParentId) : undefined}
                style={{ width: "100%" }}
                optionFilterProp="children"
                onChange={(e)=>{
                    dispatch({ type: "toggle", fieldName: "selectedParentId", payload: e });
                }}
                >
                {renderAccountOptions(state.records)}
                </Select>
              {state.edit && state.selectedHasChildren && (
                <div className='coa-placement-note'>
                  This account has {state.selectedChildCount || 'sub-'}
                  {state.selectedChildCount ? ' sub-account(s)' : 'accounts'}, so it cannot be moved —
                  its code, and every code beneath it, are built from where it sits.
                  Move the sub-accounts out first.
                </div>
              )}
            </Form.Item>
          </Col>

          {/* Sub Category */}
          <Col md={6}>
            <Form.Item label="Sub Category">
              <Select
                placeholder="Select Sub Category"
                disabled={state.isParent || state.edit}
                value={state.edit ? state.selectedRecord.subCategory : state.subCategory}
                onChange={(e) => {
                  if (state.edit) {
                    dispatch({
                      type: "toggle",
                      fieldName: "selectedRecord",
                      payload: { ...state.selectedRecord, subCategory: e },
                    });
                  } else {
                    dispatch({ type: "toggle", fieldName: "subCategory", payload: e });
                  }
                }}
              >
                <Option value="General">General</Option>
                <Option value="Cash">Cash</Option>
                <Option value="Bank">Bank</Option>
                <Option value="COGS">COGS</Option>
                <Option value="Admin Expense">Admin Expense</Option>
              </Select>
            </Form.Item>
          </Col>

          {/* Parent Switch */}
          <Col md={6}>
            <Form.Item label="Editable">
              <Switch
                disabled={state.edit}
                checked={state.editable}
                onChange={() =>
                  dispatch({
                    type: "toggle",
                    fieldName: "editable",
                    payload: !state.editable,
                  })
                }
              />
            </Form.Item>
          </Col>

          {/* Title */}
          <Col md={6}>
            <Form.Item label="Title">
              <Input
                required
                value={state.edit ? state.selectedRecord.title : state.title}
                onChange={(e) => {
                  const val = e.target.value;
                  if (state.edit) {
                    dispatch({
                      type: "toggle",
                      fieldName: "selectedRecord",
                      payload: { ...state.selectedRecord, title: val },
                    });
                  } else {
                    dispatch({ type: "toggle", fieldName: "title", payload: val });
                  }
                }}
              />
            </Form.Item>
          </Col>

          <Col md={12}>
            <hr />
            <button className="btn-custom" type="submit">
              Submit
            </button>
          </Col>

          <style jsx global>{`
            .employee-styles .coa-placement-note {
              font-size: 11px;
              line-height: 1.45;
              color: #7a5b00;
              background: #fffbe6;
              border: 1px solid #ffe58f;
              border-radius: 4px;
              padding: 5px 8px;
              margin-top: 4px;
            }
          `}</style>
        </Row>
      </Form>
      {state.edit && <CompanyVisibility table='coa' recordId={state.selectedRecord?.id} style={{ maxWidth: 420, marginTop: 8 }} />}
    </div>
  );
};

export default React.memo(CreateOrEdit);

import { Table } from 'react-bootstrap';
import React, { useEffect, useState } from 'react';
import axiosClient from 'apis/axiosClient';
import { Tag, Input, Pagination } from 'antd';
import { CheckCircleOutlined } from "@ant-design/icons";
import openNotification from 'Components/Shared/Notification';
import PopConfirm from 'Components/Shared/PopConfirm';

const PartySearch = ({ state, dispatch, reset, useWatch, control }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const chargeList = useWatch({ control, name: 'chargeList' });

  const getClients = async () => {
    // Deliberately the un-gated /getClientsForSelect endpoint, not the Setup
    // parties list route — every employee needs to pick a party for a
    // charge here, even if they can't reach Setup > Parties.
    const res = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_CLIENTS_FOR_SELECT);
    console.log("Clients:", res.data.result);
    dispatch({ type: 'toggle', fieldName: 'clientParties', payload: res.data.result });
  };

  useEffect(() => {
    getClients();
  }, []);

  const filtered = state.clientParties.filter((x) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      x?.name?.toLowerCase().includes(term) ||
      x?.code?.toLowerCase().includes(term) ||
      x?.types?.toLowerCase().includes(term)
    );
  });

  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const Row = ({ x, i }) => (
    <tr
      key={i}
      className={`${x.check ? "table-select-list-selected" : "table-select-list"}`}
      onClick={() => {
        if (!x.check) {
          const temp = [...state.clientParties];
          temp.forEach((y, idx) => {
            temp[idx].check = y.id === x.id;
          });
          dispatch({ type: 'toggle', fieldName: 'clientParties', payload: temp });
        } else {
          // An overseas agent is invoiced on an Agent Invoice / Bill, anyone
          // else on a Job Invoice / Bill.
          const agent = x.types.includes("Overseas Agent");
          const receivable = state.chargesTab == '1';
          const invoiceType = receivable ? (agent ? "Agent Invoice" : "Job Invoice") : (agent ? "Agent Bill" : "Job Bill");
          const partyType = agent ? "agent" : (receivable ? "client" : "vendor");
          const withParty = (c) => ({ ...c, name: x.name, partyId: x.id, partyType, invoiceType });
          const close = () => {
            const cleared = state.clientParties.map((c) => ({ ...c, check: false }));
            dispatch({ type: 'set', payload: { headIndex: "", headVisible: false, clientParties: cleared } });
          };
          const line = chargeList[state.headIndex];

          /* ON AN INVOICE, THE INVOICE MOVES - and keeps its number. The
           * picker is open on a line whose invoice was un-approved; a new party
           * there means the invoice was raised to the wrong one, so every line
           * on it takes the new party, and on save the server moves the
           * invoice itself (/invoice/saveHeadesNew). Not to a party of another
           * kind: an agent's would be another document, with its own series. */
          if (line.InvoiceId != null && String(line.partyId) !== String(x.id)) {
            const kind = (t) => String(t || '').replace(/^Old\s+/i, '');
            const an = (t) => `${/^[AEIOU]/i.test(t) ? 'an' : 'a'} ${t}`;
            if (line.invoiceType && kind(line.invoiceType) !== invoiceType) {
              openNotification('Error',
                `${line.invoice_id || 'This invoice'} is ${an(kind(line.invoiceType))}; ${x.name} would need ${an(invoiceType)}. Pick a party of the same kind.`,
                'red');
              return;
            }
            // A non-GL party has no ledger account for the invoice to post to -
            // said here rather than as a refused save. (The list is mostly
            // non-GL parties on a migrated book: 2,715 of 4,482 on SNS.)
            if (!(x.Client_Associations || []).some((a) => a?.ChildAccountId != null)) {
              openNotification('Error',
                `${x.name} has no ledger account, so ${line.invoice_id || 'this invoice'} cannot move to it. Give the party an account in Setup > Parties, or pick another.`,
                'red');
              return;
            }
            const sameInvoice = (c) => c.InvoiceId != null && String(c.InvoiceId) === String(line.InvoiceId);
            const count = chargeList.filter(sameInvoice).length;
            PopConfirm(
              `Move ${line.invoice_id || 'this invoice'} to ${x.name}?`,
              `It keeps its number and moves with all ${count} of its line${count === 1 ? '' : 's'}. `
                + 'Save the charges to apply it, then approve the invoice again.',
              () => {
                reset({ chargeList: chargeList.map((c) => (sameInvoice(c) ? withParty(c) : c)) });
                close();
              },
              { okText: 'Move invoice' },
            );
            return;
          }

          const temp = [...chargeList];
          temp[state.headIndex] = withParty(line);
          reset({ chargeList: temp });
          close();
        }
      }}
    >
      <td className='pt-1 text-center px-3'>
        {x.check ? <CheckCircleOutlined style={{ color: 'green', position: 'relative', bottom: 2 }} /> : i + 1}
      </td>
      <td className='pt-1'><strong>{x.code}</strong></td>
      <td className='pt-1'><strong>{x.name}</strong></td>
      <td className='pt-1 text-center'>
        {x.types?.split(", ").map((y, k) => (
          <Tag key={k} color="purple" className='mb-1'>{y}</Tag>
        ))}
      </td>
      <td className='pt-1 text-center'>{x.city}</td>
      <td className='pt-1 text-center'>
        <Tag color="geekblue" className='mb-1'>{x.person1}</Tag>
      </td>
      <td className='pt-1 text-center'>
        <Tag color="cyan" className='mb-1'>{x.mobile1}</Tag>
      </td>
    </tr>
  );

  return (
    <>
      <h5>Party Selection</h5>
      <hr />

      <Input
        style={{ width: 200 }}
        placeholder='Search by Code or Name'
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setCurrentPage(1);
        }}
      />

      <div className='table-sm-1 mt-4' style={{ maxHeight: 300, overflowY: 'auto' }}>
        <Table className='tableFixHead'>
          <thead>
            <tr>
              <th className='text-center'>#</th>
              <th className='text-center'>Code</th>
              <th className='text-center'>Name</th>
              <th className='text-center'>Types</th>
              <th className='text-center'>City</th>
              <th className='text-center'>Contact Persons</th>
              <th className='text-center'>Mobile</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((x, i) => (
              <Row key={i} x={x} i={(currentPage - 1) * pageSize + i} />
            ))}
          </tbody>
        </Table>
      </div>

      <Pagination
        current={currentPage}
        total={filtered.length}
        pageSize={pageSize}
        onChange={(p) => setCurrentPage(p)}
        style={{ marginTop: 10, textAlign: 'center' }}
      />
    </>
  );
};

export default React.memo(PartySearch);

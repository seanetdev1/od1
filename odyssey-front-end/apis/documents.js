import axiosClient from 'apis/axiosClient';

/**
 * Documents attached to a record - the backend's routes/documents. `entity`
 * is the kind of record, by its model name ('SE_Job', 'Customs_Job',
 * 'Aviation_Job', 'Vouchers', 'Invoice', 'Direct_Job'), and `recordId` its id.
 */

/** { result: [documents], rights: { add, delete }, types: [{ id, name }], limits, ready } */
export const listDocuments = (entity, recordId) => axiosClient
  .get('/documents', { params: { entity, recordId } })
  .then(({ data }) => data);

/**
 * Attach one file, as a document of type `typeId`, named `title` if given
 * ("Invoice JI-123/27" for scan020.pdf). The request body is the file itself
 * - sent as it is, not wrapped in a form or as text - so the server can write
 * it to disk as it arrives. `onProgress` gets 0..1.
 */
export const uploadDocument = (entity, recordId, typeId, file, onProgress, title) => axiosClient
  .post('/documents/upload', file, {
    params: { entity, recordId, typeId, name: file.name, ...(title ? { title } : {}) },
    headers: { 'Content-Type': 'application/octet-stream' },
    onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
    // The panel says what went wrong beside the file.
    ownErrors: true,
  })
  .then(({ data }) => data.result);

/**
 * The full URL to open a document at - short-lived, for it alone. `from` is
 * the record it is being opened from, when that is not its own: an invoice
 * showing an invoice scanned onto its job.
 */
export const documentUrl = async (id, { download = false, from } = {}) => {
  const { data } = await axiosClient.get(`/documents/${id}/link`, { params: from || {} });
  const base = axiosClient.defaults.baseURL || '';
  return `${base}${data.result.url}${download ? '&download=1' : ''}`;
};

export const deleteDocument = (id) => axiosClient.post(`/documents/${id}/delete`).then(({ data }) => data);

/** Give a document a name of its own; '' takes it away (the file's name again). The document as it is now. */
export const renameDocument = (id, title) => axiosClient.post(`/documents/${id}/rename`, { title }).then(({ data }) => data.result);

/* Configuration > Documents (Seanet). */

/** { result: [{ id, name, onInvoices, offered }], inUse: { typeId: count } } */
export const getDocumentTypes = () => axiosClient.get('/documents/types').then(({ data }) => data);
export const saveDocumentTypes = (types) => axiosClient.post('/documents/types', { types }).then(({ data }) => data);

/** { path, roots, documents, folder: { exists, marked, free, total } | null } */
export const getDocumentSettings = () => axiosClient.get('/documents/settings').then(({ data }) => data.result);
/** { path, parent, folders: [{ name, path }] } - the roots when `path` is empty. */
export const browseFolders = (path) => axiosClient
  .get('/documents/settings/browse', { params: path ? { path } : {} })
  .then(({ data }) => data.result);
/** Choose the folder. A 409 says how many documents are not in it; `force` chooses it anyway. */
export const chooseDocumentsFolder = (path, force = false) => axiosClient
  .post('/documents/settings/path', { path, ...(force ? { force: true } : {}) })
  .then(({ data }) => data.result);

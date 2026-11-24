import axiosClient from './axiosClient';

// Configuration > Customs > Statuses - see functions/customsStatuses.
export const getCustomsStatuses = () => axiosClient.get('/settings/customsStatuses').then((x) => x.data);

export const saveCustomsStatuses = (body) => axiosClient.post('/settings/customsStatuses', body).then((x) => x.data);

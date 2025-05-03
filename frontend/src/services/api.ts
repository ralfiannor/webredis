import axios from 'axios';
import { RedisConnection, KeyValue, KeyInfo } from '../types';

const api = axios.create({
  baseURL: '/api',
});

export const createConnection = async (connection: RedisConnection) => {
  const response = await api.post('/connections', connection);
  return response.data;
};

export const listConnections = async () => {
  const response = await api.get('/connections');
  return response.data;
};

export const deleteConnection = async (id: string) => {
  await api.delete(`/connections/${id}`);
};

export const listDatabases = async (id: string) => {
  const response = await api.get(`/databases/${id}`);
  return response.data;
};

export interface KeyListResponse {
  keys: KeyInfo[];
  nextCursor: string;
  hasMore: boolean;
}

export const listKeys = async (connectionId: string, db: number, cursor: string = '0', batchSize: number = 100): Promise<KeyListResponse> => {
  try {
    const response = await api.get(`/keys/${connectionId}/${db}?cursor=${cursor}&batchSize=${batchSize}`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const getKey = async (id: string, db: number, key: string) => {
  const response = await api.get(`/key/${id}/${db}/${key}`);
  return response.data;
};

export const setKey = async (id: string, db: number, key: string, value: KeyValue) => {
  const response = await api.post(`/key/${id}/${db}/${key}`, {
    type: value.type,
    value: value.value,
    ttl: value.ttl || 0,
  });
  return response.data;
};

export const deleteKey = async (id: string, db: number, key: string) => {
  await api.delete(`/key/${id}/${db}/${key}`);
};

export const executeCommand = async (id: string, db: number, command: string, args: string[]) => {
  const response = await api.post(`/execute/${id}/${db}`, { command, args });
  return response.data;
}; 
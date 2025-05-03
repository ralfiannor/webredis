export interface RedisConnection {
  id: string;
  name: string;
  host: string;
  port: string;
  password?: string;
  db: number;
}

export interface KeyValue {
  type: string;
  value: any;
  ttl?: number;
}

export interface DatabaseInfo {
  id: string;
  name: string;
  keys: number;
}

export interface ConnectionState {
  id: string;
  name: string;
  host: string;
  port: string;
  isConnected: boolean;
}

export interface KeyInfo {
  key: string;
  ttl: number;
  type: string;
} 
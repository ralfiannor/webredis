import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Card, Select, Table, Button, Modal, Form, Input, message, Space, Typography, Tree } from 'antd';
import { DeleteOutlined, PlusOutlined, CodeOutlined, FolderOutlined, FileOutlined } from '@ant-design/icons';
import { listConnections, listDatabases, listKeys, getKey, setKey, deleteKey, executeCommand } from '../services/api';
import { KeyValue, KeyInfo } from '../types';

const formatTTL = (ttl: number) => {
  if (ttl === -1) return 'No expiry';
  if (ttl === -2) return 'Error';
  if (ttl < 0) return 'Persistent';
  
  const days = Math.floor(ttl / 86400);
  const hours = Math.floor((ttl % 86400) / 3600);
  const minutes = Math.floor((ttl % 3600) / 60);
  const seconds = Math.floor(ttl % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return parts.join(' ') || '0s';
};

const TTLCountdown: React.FC<{ initialTTL: number }> = ({ initialTTL }) => {
  const [ttl, setTTL] = useState(initialTTL);

  useEffect(() => {
    if (ttl <= 0) return;

    const timer = setInterval(() => {
      setTTL(prev => {
        const newTTL = prev - 1;
        if (newTTL <= 0) {
          clearInterval(timer);
          return 0;
        }
        return newTTL;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [initialTTL]);

  // Only update when the TTL changes significantly
  const displayTTL = useMemo(() => formatTTL(ttl), [ttl]);

  return <span>{displayTTL}</span>;
};

const formatKeyType = (type: string) => {
  // Capitalize first letter and format the type name
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
};

const formatKeyValue = (value: any, type: string) => {
  if (!value) return '';

  try {
    // Helper function to handle binary data
    const handleBinaryData = (data: any): string => {
      if (typeof data === 'object' && data !== null && data.type === 'binary') {
        try {
          const decoded = atob(data.data);
          // Try to convert to string if it's text
          try {
            const text = new TextDecoder().decode(new Uint8Array(decoded.split('').map(c => c.charCodeAt(0))));
            return `[Text Data]\n${text}\n\n[Raw Data]\n${decoded}`;
          } catch {
            // If it's not text, show as binary data
            return `[Binary Data] ${decoded.length} bytes\n\n[Raw Data]\n${decoded}`;
          }
        } catch {
          return '[Binary Data]';
        }
      }
      return String(data);
    };

    // Helper function to format any value
    const formatAnyValue = (val: any): string => {
      if (typeof val === 'object' && val !== null) {
        if (Array.isArray(val)) {
          return val.map((item, index) => `${index + 1}. ${formatAnyValue(item)}`).join('\n');
        }
        if (val.type === 'binary') {
          return handleBinaryData(val);
        }
        try {
          return JSON.stringify(val, null, 2);
        } catch {
          return String(val);
        }
      }
      return String(val);
    };

    // First, try to parse as JSON if it looks like JSON
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(value);
          return JSON.stringify(parsed, null, 2);
        } catch {
          // If it's not valid JSON, continue with normal formatting
        }
      }
    }

    // If not JSON or JSON parsing failed, format based on type
    switch (type.toLowerCase()) {
      case 'string':
        return formatAnyValue(value);
      case 'list':
        if (Array.isArray(value)) {
          return value.map((item, index) => `${index + 1}. ${formatAnyValue(item)}`).join('\n');
        }
        return formatAnyValue(value);
      case 'set':
        if (Array.isArray(value)) {
          return value.map((item, index) => `${index + 1}. ${formatAnyValue(item)}`).join('\n');
        }
        return formatAnyValue(value);
      case 'hash':
        if (typeof value === 'object' && value !== null) {
          return Object.entries(value)
            .map(([k, v]) => `${k}: ${formatAnyValue(v)}`)
            .join('\n');
        }
        return formatAnyValue(value);
      case 'zset':
        if (Array.isArray(value)) {
          return value
            .map((item: any) => {
              if (typeof item === 'object' && item !== null) {
                return `${item.score}: ${formatAnyValue(item.member)}`;
              }
              return formatAnyValue(item);
            })
            .join('\n');
        }
        return formatAnyValue(value);
      default:
        return formatAnyValue(value);
    }
  } catch (error) {
    console.error('Error formatting value:', error);
    return '[Error formatting value]';
  }
};

interface Connection {
  id: string;
  name: string;
}

const DatabaseViewer: React.FC = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [databases, setDatabases] = useState<number[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<number>(0);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingKeys, setIsLoadingKeys] = useState<boolean>(false);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState<boolean>(false);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [keyValue, setKeyValue] = useState<KeyValue | null>(null);
  const [selectedKeyInfo, setSelectedKeyInfo] = useState<KeyInfo | null>(null);
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);
  const [isDetailModalVisible, setIsDetailModalVisible] = useState<boolean>(false);
  const [form] = Form.useForm();
  const [showTree, setShowTree] = useState<boolean>(true);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [command, setCommand] = useState<string>('');
  const [commandArgs, setCommandArgs] = useState<string[]>(['']);
  const [commandResult, setCommandResult] = useState<any>(null);
  const [isCommandModalVisible, setIsCommandModalVisible] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedValue, setEditedValue] = useState<string>('');
  const prevDatabaseRef = useRef<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string>('0');
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [searchText, setSearchText] = useState<string>('');
  const [messageApi, contextHolder] = message.useMessage();

  // Optimize message handling with minimal updates
  const showMessage = useMemo(() => {
    let messageTimeout: NodeJS.Timeout | null = null;
    const MESSAGE_DELAY = 500; // Increased delay to prevent rapid updates

    return {
      success: (content: string) => {
        if (messageTimeout) {
          clearTimeout(messageTimeout);
        }
        messageTimeout = setTimeout(() => {
          messageApi.success(content);
        }, MESSAGE_DELAY);
      },
      error: (content: string) => {
        if (messageTimeout) {
          clearTimeout(messageTimeout);
        }
        messageTimeout = setTimeout(() => {
          messageApi.error(content);
        }, MESSAGE_DELAY);
      }
    };
  }, [messageApi]);

  // Add useEffect to load connections on mount
  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (selectedConnection) {
      setIsLoadingDatabases(true);
      loadDatabases().finally(() => setIsLoadingDatabases(false));
      setSelectedDatabase(0);
    }
  }, [selectedConnection]);

  useEffect(() => {
    if (selectedConnection && selectedDatabase !== undefined) {
      loadKeys();
    }
  }, [selectedConnection, selectedDatabase]);

  const loadConnections = async () => {
    try {
      setIsLoading(true);
      const data = await listConnections();
      setConnections(data);
    } catch (error) {
      showMessage.error('Failed to load connections');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDatabases = async () => {
    try {
      setIsLoadingDatabases(true);
      const data = await listDatabases(selectedConnection);
      setDatabases(data);
    } catch (error) {
      showMessage.error('Failed to load databases');
    } finally {
      setIsLoadingDatabases(false);
    }
  };

  const loadKeys = async (loadMore: boolean = false) => {
    try {
      setIsLoadingKeys(true);
      const data = await listKeys(selectedConnection, selectedDatabase, loadMore ? cursor : '0', 1000);
      if (!data || !data.keys) {
        showMessage.error('Invalid response format from server');
        return;
      }

      if (loadMore) {
        setKeys(prevKeys => [...prevKeys, ...data.keys]);
      } else {
        setKeys(data.keys);
      }

      setCursor(data.nextCursor);
      setHasMore(data.hasMore);

      if (selectedDatabase !== prevDatabaseRef.current) {
        setSelectedKey('');
        setKeyValue(null);
        prevDatabaseRef.current = selectedDatabase;
      }
    } catch (error: any) {
      if (error.response?.status === 500) {
        showMessage.error('Connection error. Please check your Redis connection.');
        setConnections(prev => prev.filter(conn => conn.id !== selectedConnection));
        setSelectedConnection('');
      } else {
        showMessage.error('Failed to load keys');
      }
      if (!loadMore) {
        setKeys([]);
      }
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const handleKeySelect = async (key: string) => {
    try {
      setIsLoading(true);
      const data = await getKey(selectedConnection, selectedDatabase, key);
      setKeyValue(data);
      setSelectedKey(key);
      const keyInfo = keys.find(k => k.key === key);
      if (keyInfo) {
        setSelectedKeyInfo(keyInfo);
        setIsDetailModalVisible(true);
      }
    } catch (error) {
      showMessage.error('Failed to load key value');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteKey = async (key: string) => {
    try {
      setIsLoading(true);
      await deleteKey(selectedConnection, selectedDatabase, key);
      showMessage.success('Key deleted successfully');
      setKeys(prevKeys => prevKeys.filter(k => k.key !== key));
      if (selectedKey === key) {
        setSelectedKey('');
        setKeyValue(null);
        setIsDetailModalVisible(false);
      }
    } catch (error) {
      showMessage.error('Failed to delete key');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = async (values: any) => {
    try {
      setIsLoading(true);
      await setKey(selectedConnection, selectedDatabase, values.key, {
        type: values.type,
        value: values.value,
        ttl: values.ttl ? parseInt(values.ttl) : 0,
      });
      showMessage.success('Key saved successfully');
      setIsModalVisible(false);
      form.resetFields();
      const newKey: KeyInfo = {
        key: values.key,
        ttl: values.ttl ? parseInt(values.ttl) : -1,
        type: values.type
      };
      setKeys(prevKeys => {
        const existingKeyIndex = prevKeys.findIndex(k => k.key === values.key);
        if (existingKeyIndex >= 0) {
          const newKeys = [...prevKeys];
          newKeys[existingKeyIndex] = newKey;
          return newKeys;
        }
        return [...prevKeys, newKey];
      });
    } catch (error) {
      showMessage.error('Failed to save key');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecuteCommand = async () => {
    try {
      setIsLoading(true);
      const args = commandArgs.filter(arg => arg.trim() !== '');
      const result = await executeCommand(selectedConnection, selectedDatabase, command, args);
      setCommandResult(result);
      showMessage.success('Command executed successfully');
      if (['DEL', 'SET', 'EXPIRE', 'PERSIST', 'RENAME', 'MOVE'].includes(command.toUpperCase())) {
        loadKeys();
      }
    } catch (error) {
      showMessage.error('Failed to execute command');
    } finally {
      setIsLoading(false);
    }
  };

  const addCommandArg = () => {
    setCommandArgs([...commandArgs, '']);
  };

  const removeCommandArg = (index: number) => {
    const newArgs = [...commandArgs];
    newArgs.splice(index, 1);
    setCommandArgs(newArgs);
  };

  const updateCommandArg = (index: number, value: string) => {
    const newArgs = [...commandArgs];
    newArgs[index] = value;
    setCommandArgs(newArgs);
  };

  const handleEditValue = () => {
    if (keyValue) {
      setEditedValue(formatKeyValue(keyValue.value, keyValue.type));
      setIsEditing(true);
    }
  };

  const handleSaveValue = async () => {
    try {
      setIsLoading(true);
      let valueToSave = editedValue;

      if (editedValue.trim().startsWith('{') || editedValue.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(editedValue);
          valueToSave = JSON.stringify(parsed);
        } catch (error) {
          // If it's not valid JSON, keep the original value
        }
      }

      const currentKey = keys.find(k => k.key === selectedKey);
      const ttl = currentKey?.ttl || 0;
      
      const requestBody = {
        type: keyValue?.type || 'string',
        value: valueToSave,
        ttl: Math.max(0, Math.floor(ttl)),
      };

      await setKey(selectedConnection, selectedDatabase, selectedKey, requestBody);
      showMessage.success('Value updated successfully');
      setIsEditing(false);
      const data = await getKey(selectedConnection, selectedDatabase, selectedKey);
      setKeyValue(data);
    } catch (error) {
      showMessage.error('Failed to update value');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedValue('');
  };

  const columns = [
    {
      title: 'Key',
      dataIndex: 'key',
      key: 'key',
      render: (text: string) => (
        <a onClick={() => handleKeySelect(text)}>{text}</a>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <span>{formatKeyType(type)}</span>
      ),
    },
    {
      title: 'TTL',
      dataIndex: 'ttl',
      key: 'ttl',
      render: (ttl: number) => formatTTL(ttl),
    },
  ];

  // Add filtered keys based on search
  const filteredKeys = useMemo(() => {
    if (!searchText) return keys;
    return keys.filter(key => 
      key.key.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [keys, searchText]);

  // Memoize the tree data with optimized structure
  const treeData = useMemo(() => {
    const buildTree = (keys: KeyInfo[]): any[] => {
      const tree: { [key: string]: any } = {};
      
      // Pre-allocate arrays for better performance
      const keyArray = Array.isArray(keys) ? keys : [];
      
      for (let i = 0; i < keyArray.length; i++) {
        const key = keyArray[i];
        const parts = key.key.split(':');
        let current = tree;
        let path = '';
        
        for (let j = 0; j < parts.length; j++) {
          const part = parts[j];
          path = path ? `${path}:${part}` : part;
          const isLast = j === parts.length - 1;
          
          if (!current[part]) {
            current[part] = {
              title: isLast ? path : `${part} (0)`,
              key: path,
              isLeaf: isLast,
              type: isLast ? key.type : 'folder',
              ttl: isLast ? key.ttl : -1,
              children: isLast ? undefined : {},
              count: 0
            };
          } else if (!isLast) {
            current[part].count++;
          }
          
          if (!isLast) {
            current = current[part].children;
          }
        }
      }

      const convertToArray = (obj: { [key: string]: any }): any[] => {
        const result: any[] = [];
        for (const [, value] of Object.entries(obj)) {
          result.push({
            ...value,
            title: value.isLeaf ? value.title : `${value.title.split(' (')[0]} (${value.count} keys)`,
            children: value.children ? convertToArray(value.children) : undefined
          });
        }
        return result;
      };

      return convertToArray(tree);
    };

    return buildTree(filteredKeys);
  }, [filteredKeys]);

  // Memoize the tree component with optimized event handling
  const TreeComponent = useMemo(() => {
    const handleExpand = useCallback((keys: React.Key[]) => {
      setExpandedKeys(keys);
    }, []);

    const handleSelect = useCallback((selectedKeys: React.Key[], info: any) => {
      if (info.node.isLeaf) {
        handleKeySelect(selectedKeys[0] as string);
      }
    }, [handleKeySelect]);

    const handleTitleClick = useCallback((e: React.MouseEvent, nodeData: any) => {
      e.stopPropagation();
      if (nodeData.isLeaf) {
        handleKeySelect(nodeData.key);
      }
    }, [handleKeySelect]);

    return (
      <Tree
        treeData={treeData}
        showLine={true}
        blockNode={true}
        expandedKeys={expandedKeys}
        onExpand={handleExpand}
        onSelect={handleSelect}
        icon={(props: any) => {
          if (props.isLeaf) {
            return <FileOutlined style={{ color: '#1890ff' }} />;
          }
          return <FolderOutlined style={{ color: '#faad14' }} />;
        }}
        titleRender={(nodeData: any) => (
          <span 
            onClick={(e) => handleTitleClick(e, nodeData)}
            style={{ 
              cursor: 'pointer',
              display: 'block',
              width: '100%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {nodeData.isLeaf ? nodeData.title : (
              <>
                {nodeData.title.split(' (')[0]}
                <span style={{ color: '#999' }}> ({nodeData.count} keys)</span>
              </>
            )}
          </span>
        )}
      />
    );
  }, [treeData, expandedKeys, handleKeySelect]);

  // Optimize the tree view container with minimal re-renders
  const treeView = useMemo(() => {
    const handleLoadMore = useCallback(() => {
      loadKeys(true);
    }, [loadKeys]);

    return (
      <div 
        ref={containerRef}
        style={{ 
          backgroundColor: '#fff', 
          padding: '16px', 
          borderRadius: '4px',
          border: '1px solid #f0f0f0',
          maxHeight: '600px',
          overflow: 'auto'
        }}
      >
        {isLoadingKeys && !keys.length ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div>Loading keys...</div>
            <div style={{ marginTop: '10px', color: '#666' }}>
              This may take a few moments depending on the number of keys
            </div>
          </div>
        ) : keys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            No keys found
          </div>
        ) : (
          <>
            <div style={{ 
              marginBottom: '16px', 
              color: '#666',
              position: 'sticky',
              top: 0,
              backgroundColor: '#fff',
              zIndex: 1,
              padding: '8px 0'
            }}>
              Total Keys: {keys.length} scanned
            </div>
            {TreeComponent}
            {hasMore && (
              <div style={{ 
                textAlign: 'left', 
                marginTop: '16px',
                position: 'sticky',
                bottom: 0,
                backgroundColor: '#fff',
                zIndex: 1,
                padding: '8px 0'
              }}>
                <Button 
                  type="primary" 
                  onClick={handleLoadMore}
                  loading={isLoadingKeys}
                >
                  Scan More
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }, [isLoadingKeys, keys.length, hasMore, TreeComponent, loadKeys]);

  return (
    <div style={{ padding: '24px' }}>
      {contextHolder}
      <Card title="Database Viewer">
        <div style={{ marginBottom: 16 }}>
          <Select
            style={{ width: 200, marginRight: 16 }}
            placeholder="Select Connection"
            value={selectedConnection}
            onChange={setSelectedConnection}
            loading={isLoading}
          >
            {connections.map((conn) => (
              <Select.Option key={conn.id} value={conn.id}>
                {conn.name}
              </Select.Option>
            ))}
          </Select>
          {selectedConnection && (
            <Select
              style={{ width: 200, marginRight: 16 }}
              value={selectedDatabase}
              onChange={setSelectedDatabase}
              loading={isLoadingDatabases}
            >
              {databases.map((db) => (
                <Select.Option key={db} value={db}>
                  Database {db}
                </Select.Option>
              ))}
            </Select>
          )}
          {selectedConnection && (
            <>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setIsModalVisible(true)}
                style={{ marginRight: 8 }}
                loading={isLoading}
              >
                Add Key
              </Button>
              <Button
                type="default"
                icon={<CodeOutlined />}
                onClick={() => setIsCommandModalVisible(true)}
                loading={isLoading}
                style={{ marginRight: 8 }}
              >
                Execute Command
              </Button>
              <Button
                type={showTree ? "primary" : "default"}
                onClick={() => setShowTree(!showTree)}
                loading={isLoadingKeys}
                style={{ marginRight: 8 }}
              >
                {showTree ? "Show Flat List" : "Show Tree View"}
              </Button>
            </>
          )}
        </div>

        {selectedConnection ? (
          <>
            {showTree ? (
              <>
                <Input.Search
                  placeholder="Search keys..."
                  allowClear
                  onChange={(e) => setSearchText(e.target.value)}
                  style={{ marginBottom: 16, width: 300 }}
                />
                {treeView}
              </>
            ) : (
              <>
                {isLoadingKeys ? (
                  <div style={{ textAlign: 'center', padding: '20px' }}>
                    Loading keys...
                  </div>
                ) : keys.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px' }}>
                    No keys found
                  </div>
                ) : (
                  <>
                    <Table
                      columns={columns}
                      dataSource={keys}
                      rowKey="key"
                      pagination={false}
                    />
                  </>
                )}
              </>
            )}

            {/* Key Detail Modal */}
            <Modal
              title={`Key: ${selectedKey}`}
              open={isDetailModalVisible}
              onCancel={() => {
                setIsDetailModalVisible(false);
                setSelectedKeyInfo(null);
              }}
              footer={[
                <Button
                  key="delete"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    handleDeleteKey(selectedKey);
                    setIsDetailModalVisible(false);
                  }}
                  loading={isLoading}
                >
                  Delete Key
                </Button>,
                <Button
                  key="edit"
                  type="primary"
                  onClick={handleEditValue}
                  loading={isLoading}
                >
                  Edit Value
                </Button>,
              ]}
              width={800}
            >
              {selectedKeyInfo && keyValue && (
                <div>
                  <p>Type: {formatKeyType(keyValue.type)}</p>
                  <p>TTL: {selectedKeyInfo.ttl > 0 ? <TTLCountdown initialTTL={selectedKeyInfo.ttl} /> : formatTTL(selectedKeyInfo.ttl)}</p>
                  <div style={{ marginTop: '16px' }}>
                    <pre style={{ 
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '400px',
                      overflow: 'auto',
                      backgroundColor: '#f5f5f5',
                      padding: '12px',
                      borderRadius: '4px'
                    }}>
                      {formatKeyValue(keyValue.value, keyValue.type)}
                    </pre>
                  </div>
                </div>
              )}
            </Modal>

            {/* Edit Value Modal */}
            {isEditing && (
              <Modal
                title="Edit Value"
                open={isEditing}
                onCancel={handleCancelEdit}
                footer={[
                  <Button key="cancel" onClick={handleCancelEdit}>
                    Cancel
                  </Button>,
                  <Button key="save" type="primary" onClick={handleSaveValue} loading={isLoading}>
                    Save
                  </Button>,
                ]}
                width={800}
              >
                <Input.TextArea
                  value={editedValue}
                  onChange={(e) => setEditedValue(e.target.value)}
                  autoSize={{ minRows: 4, maxRows: 10 }}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    lineHeight: '1.5',
                  }}
                />
              </Modal>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            Please select a connection to view keys
          </div>
        )}

        <Modal
          title="Execute Redis Command"
          open={isCommandModalVisible}
          onCancel={() => {
            setIsCommandModalVisible(false);
            setCommand('');
            setCommandArgs(['']);
            setCommandResult(null);
          }}
          footer={null}
          width={600}
        >
          <Form layout="vertical">
            <Form.Item label="Command">
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value.toUpperCase())}
                placeholder="e.g., SET, GET, DEL, etc."
              />
            </Form.Item>
            <Form.Item label="Arguments">
              {commandArgs.map((arg, index) => (
                <Space key={index} style={{ marginBottom: 8 }}>
                  <Input
                    value={arg}
                    onChange={(e) => updateCommandArg(index, e.target.value)}
                    placeholder={`Argument ${index + 1}`}
                  />
                  {index > 0 && (
                    <Button
                      danger
                      onClick={() => removeCommandArg(index)}
                    >
                      Remove
                    </Button>
                  )}
                </Space>
              ))}
              <Button type="dashed" onClick={addCommandArg} block>
                Add Argument
              </Button>
            </Form.Item>
            <Form.Item>
              <Button type="primary" onClick={handleExecuteCommand} block loading={isLoading}>
                Execute
              </Button>
            </Form.Item>
            {commandResult && (
              <Form.Item label="Result">
                <Typography.Text code>
                  {JSON.stringify(commandResult, null, 2)}
                </Typography.Text>
              </Form.Item>
            )}
          </Form>
        </Modal>
      </Card>

      <Modal
        title="Add Key"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSaveKey}
        >
          <Form.Item
            name="key"
            label="Key"
            rules={[{ required: true, message: 'Please input the key!' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="type"
            label="Type"
            rules={[{ required: true, message: 'Please select the type!' }]}
          >
            <Select>
              <Select.Option value="string">String</Select.Option>
              <Select.Option value="list">List</Select.Option>
              <Select.Option value="set">Set</Select.Option>
              <Select.Option value="hash">Hash</Select.Option>
              <Select.Option value="zset">Sorted Set</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="value"
            label="Value"
            rules={[{ required: true, message: 'Please input the value!' }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item
            name="ttl"
            label="TTL (seconds)"
            tooltip="Time to live in seconds. Leave empty for no expiration."
          >
            <Input type="number" min="0" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isLoading}>
              Save
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DatabaseViewer; 
import React, { useState, useEffect, useMemo, useRef, useCallback, useTransition } from 'react';
import { Card, Select, Table, Button, Modal, Form, Input, message, Space, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, CodeOutlined, FolderOutlined, FileOutlined } from '@ant-design/icons';
import { FixedSizeList as List } from 'react-window';
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
  const [command, setCommand] = useState<string>('');
  const [commandArgs, setCommandArgs] = useState<string[]>(['']);
  const [commandResult, setCommandResult] = useState<any>(null);
  const [isCommandModalVisible, setIsCommandModalVisible] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedValue, setEditedValue] = useState<string>('');
  const prevDatabaseRef = useRef<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string>('0');
  const [searchText, setSearchText] = useState<string>('');
  const [messageApi, contextHolder] = message.useMessage();

  // Add state for tracking expanded folders
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

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
      console.log('Loading keys, loadMore:', loadMore, 'selectedConnection:', selectedConnection, 'selectedDatabase:', selectedDatabase);
      setIsLoadingKeys(true);
      const data = await listKeys(selectedConnection, selectedDatabase, loadMore ? cursor : '0', 1000);
      console.log('Received keys data:', data);
      
      if (!data || !data.keys) {
        console.error('Invalid response format from server');
        showMessage.error('Invalid response format from server');
        return;
      }

      console.log('Keys received from server:', data.keys.length);
      console.log('Sample keys from server:', data.keys.slice(0, 5));

      const newKeys = data.keys.map((key: any) => ({
        key: key.key,
        ttl: key.ttl,
        type: key.type
      }));

      if (loadMore) {
        console.log('Appending more keys, current count:', keys.length, 'new keys:', newKeys.length);
        setKeys(prevKeys => [...prevKeys, ...newKeys]);
      } else {
        console.log('Setting new keys, count:', newKeys.length);
        setKeys(newKeys);
      }

      setCursor(data.nextCursor);

      if (selectedDatabase !== prevDatabaseRef.current) {
        setSelectedKey('');
        setKeyValue(null);
        prevDatabaseRef.current = selectedDatabase;
      }
    } catch (error: any) {
      console.error('Error loading keys:', error);
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
    console.log('Filtering keys, total keys:', keys.length, 'search text:', searchText);
    if (!searchText) return keys;
    const filtered = keys.filter(key => 
      key.key.toLowerCase().includes(searchText.toLowerCase())
    );
    console.log('Filtered keys count:', filtered.length);
    return filtered;
  }, [keys, searchText]);

  // Build tree directly without worker
  const buildTree = (keys: KeyInfo[]) => {
    console.log('[Frontend] Building tree with keys:', keys);
    
    // Create a map to store nodes by their full path
    const nodeMap = new Map<string, any>();
    
    // First pass: create all nodes
    keys.forEach(key => {
      if (!key || !key.key) return;
      
      const parts = key.key.split(':');
      let currentPath = '';
      
      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}:${part}` : part;
        const isLast = index === parts.length - 1;
        
        if (!nodeMap.has(currentPath)) {
          nodeMap.set(currentPath, {
            title: part,
            key: currentPath,
            isLeaf: isLast,
            type: isLast ? key.type : 'folder',
            ttl: isLast ? key.ttl : -1,
            children: [],
            count: 0,
            hasChildren: !isLast,
            isExpanded: false,
            fullKey: isLast ? key.key : undefined
          });
        }
      });
    });
    
    console.log('[Frontend] Node map created:', Array.from(nodeMap.entries()));
    
    // Second pass: build the tree structure
    const rootNodes: any[] = [];
    
    nodeMap.forEach((node, path) => {
      const parts = path.split(':');
      if (parts.length === 1) {
        // This is a root node
        rootNodes.push(node);
      } else {
        // This is a child node
        const parentPath = parts.slice(0, -1).join(':');
        const parent = nodeMap.get(parentPath);
        if (parent) {
          parent.children.push(node);
          parent.count++;
        }
      }
    });
    
    console.log('[Frontend] Tree structure built:', rootNodes);
    
    // Update titles with counts and full keys
    const updateTitles = (nodes: any[]) => {
      nodes.forEach(node => {
        if (node.isLeaf) {
          // For leaf nodes, show the full key and type
          node.title = `${node.fullKey} (${node.type})`;
        } else {
          // For folders, show the count of all keys under this folder
          const countKeys = (node: any): number => {
            if (node.isLeaf) return 1;
            return node.children.reduce((sum: number, child: any) => sum + countKeys(child), 0);
          };
          const totalKeys = countKeys(node);
          node.title = `${node.title} (${totalKeys} keys)`;
        }
        if (node.children.length > 0) {
          updateTitles(node.children);
        }
      });
    };
    
    updateTitles(rootNodes);
    console.log('[Frontend] Final tree structure:', JSON.stringify(rootNodes, null, 2));
    return rootNodes;
  };

  // Memoize the tree data
  const [treeData, setTreeData] = useState<any[]>([]);
  const [, startTransition] = useTransition();
  const processingRef = useRef<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const processData = () => {
      if (processingRef.current) {
        return;
      }

      try {
        processingRef.current = true;
        console.log('[Frontend] Processing filtered keys:', filteredKeys);
        const result = buildTree(filteredKeys);
        
        if (isMounted) {
          startTransition(() => {
            console.log('[Frontend] Setting tree data:', result);
            setTreeData(result);
            // Initialize expanded folders with root nodes
            const rootPaths = result.map(node => node.key);
            setExpandedFolders(new Set(rootPaths));
          });
        }
      } catch (error) {
        console.error('[Frontend] Error processing tree data:', error);
        if (isMounted) {
          setTreeData([]);
        }
      } finally {
        processingRef.current = false;
      }
    };

    if (filteredKeys.length > 0) {
      console.log('[Frontend] Starting data processing with keys:', filteredKeys);
      processData();
    } else {
      console.log('[Frontend] No keys to process');
      setTreeData([]);
    }

    return () => {
      isMounted = false;
    };
  }, [filteredKeys]);

  // Flatten the tree data for virtualized list
  const flattenedData = useMemo(() => {
    if (!treeData || !Array.isArray(treeData)) {
      console.log('[Frontend] Invalid tree data:', treeData);
      return [];
    }

    const flatten = (nodes: any[], level: number = 0, parentPath: string = ''): any[] => {
      return nodes.reduce((acc: any[], node: any) => {
        if (!node || typeof node !== 'object') {
          console.log('[Frontend] Invalid node in flatten:', node);
          return acc;
        }

        const path = parentPath ? `${parentPath}:${node.key}` : node.key;
        const isExpanded = expandedFolders.has(path);
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;

        const flattenedNode = {
          ...node,
          level,
          path,
          isExpanded,
          hasChildren,
          children: undefined // Remove children from flattened node
        };

        acc.push(flattenedNode);

        if (hasChildren && isExpanded) {
          const childNodes = flatten(node.children, level + 1, path);
          acc.push(...childNodes);
        }

        return acc;
      }, []);
    };

    const result = flatten(treeData);
    console.log('[Frontend] Tree View State:', {
      totalKeys: keys.length,
      treeNodes: treeData.length,
      flattenedNodes: result.length,
      expandedFolders: Array.from(expandedFolders).length,
      firstNode: treeData[0],
      flattenedData: JSON.stringify(result, null, 2)
    });
    return result;
  }, [treeData, expandedFolders, keys.length]);

  // Virtualized tree component
  const VirtualizedTree = React.memo(({ data, onSelect }: any) => {
    console.log('VirtualizedTree render, data length:', data.length);
    console.log('First few items in VirtualizedTree:', data.slice(0, 5));
    const rowHeight = 32;
    const containerRef = useRef<HTMLDivElement>(null);

    const handleToggle = useCallback((path: string) => {
      setExpandedFolders(prev => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    }, []);

    const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
      const node = data[index];
      if (!node) {
        console.error('Invalid node at index:', index);
        return null;
      }

      const paddingLeft = node.level * 20;

      const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (node.hasChildren) {
          handleToggle(node.path);
        } else {
          onSelect([node.key], { node });
        }
      };

      return (
        <div
          style={{
            ...style,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: `${paddingLeft}px`,
            cursor: 'pointer',
            backgroundColor: index % 2 === 0 ? '#fafafa' : '#fff',
          }}
          onClick={handleClick}
        >
          {node.hasChildren ? (
            <span 
              style={{ 
                marginRight: 8, 
                width: 16, 
                display: 'flex', 
                alignItems: 'center',
                cursor: 'pointer'
              }}
            >
              {node.isExpanded ? '▼' : '▶'}
            </span>
          ) : (
            <span style={{ marginRight: 8, width: 16 }} />
          )}
          {node.hasChildren ? (
            <FolderOutlined style={{ color: '#faad14', marginRight: 8 }} />
          ) : (
            <FileOutlined style={{ color: '#1890ff', marginRight: 8 }} />
          )}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.title}
          </span>
        </div>
      );
    }, [data, onSelect, handleToggle]);

    if (!data || data.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          No keys found
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        style={{
          height: '600px',
          overflow: 'auto',
          border: '1px solid #f0f0f0',
          borderRadius: '4px',
        }}
      >
        <List
          height={600}
          itemCount={data.length}
          itemSize={rowHeight}
          width="100%"
        >
          {Row}
        </List>
      </div>
    );
  });

  // Optimize tree view container
  const treeView = useMemo(() => {
    console.log('Rendering tree view with flattenedData:', {
      length: flattenedData.length,
      sample: flattenedData.slice(0, 5)
    });

    const handleSelect = useCallback((selectedKeys: React.Key[], info: any) => {
      if (info.node && !info.node.hasChildren) {
        handleKeySelect(selectedKeys[0] as string);
      }
    }, [handleKeySelect]);

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
              padding: '8px 0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                Total Keys: {keys.length} scanned
              </div>
              <Button
                type="primary"
                onClick={() => loadKeys(true)}
                loading={isLoadingKeys}
                disabled={!cursor || cursor === '0'}
              >
                Scan More
              </Button>
            </div>
            {flattenedData.length > 0 ? (
              <VirtualizedTree
                data={flattenedData}
                onSelect={handleSelect}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                Processing tree data...
              </div>
            )}
          </>
        )}
      </div>
    );
  }, [flattenedData, handleKeySelect, isLoadingKeys, keys.length]);

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
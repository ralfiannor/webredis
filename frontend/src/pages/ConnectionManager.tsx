import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, List, message, Modal } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { createConnection, listConnections, deleteConnection } from '../services/api';
import { RedisConnection, ConnectionState } from '../types';

const ConnectionManager: React.FC = () => {
  const [connections, setConnections] = useState<ConnectionState[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      const data = await listConnections();
      setConnections(data.map((id: string) => ({
        id,
        host: id.split(':')[0],
        port: id.split(':')[1],
        isConnected: true,
      })));
    } catch (error) {
      message.error('Failed to load connections');
    }
  };

  const handleAddConnection = async (values: RedisConnection) => {
    try {
      await createConnection(values);
      message.success('Connection added successfully');
      setIsModalVisible(false);
      form.resetFields();
      loadConnections();
    } catch (error) {
      message.error('Failed to add connection');
    }
  };

  const handleDeleteConnection = async (id: string) => {
    try {
      await deleteConnection(id);
      message.success('Connection deleted successfully');
      loadConnections();
    } catch (error) {
      message.error('Failed to delete connection');
    }
  };

  return (
    <div>
      <Card
        title="Redis Connections"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsModalVisible(true)}
          >
            Add Connection
          </Button>
        }
      >
        <List
          dataSource={connections}
          renderItem={(connection) => (
            <List.Item
              actions={[
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDeleteConnection(connection.id)}
                />,
              ]}
            >
              <List.Item.Meta
                title={`${connection.host}:${connection.port}`}
                description={connection.isConnected ? 'Connected' : 'Disconnected'}
              />
            </List.Item>
          )}
        />
      </Card>

      <Modal
        title="Add Redis Connection"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddConnection}
          initialValues={{ host: 'localhost', port: '6379', db: 0 }}
        >
          <Form.Item
            name="host"
            label="Host"
            rules={[{ required: true, message: 'Please input the host!' }]}
          >
            <Input placeholder="localhost" />
          </Form.Item>
          <Form.Item
            name="port"
            label="Port"
            rules={[{ required: true, message: 'Please input the port!' }]}
          >
            <Input placeholder="6379" />
          </Form.Item>
          <Form.Item name="password" label="Password">
            <Input.Password placeholder="Password (optional)" />
          </Form.Item>
          <Form.Item
            name="db"
            label="Database"
            rules={[{ required: true, message: 'Please input the database number!' }]}
          >
            <Input type="number" min={0} max={15} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              Connect
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ConnectionManager; 
package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

type Connection struct {
	ID       string
	Host     string
	Port     string
	Password string
	DB       int
}

var db *sql.DB

func initDB() error {
	// Create data directory if it doesn't exist
	if err := os.MkdirAll("data", 0755); err != nil {
		return fmt.Errorf("failed to create data directory: %v", err)
	}

	// Open database connection
	var err error
	dbPath := filepath.Join("data", "connections.db")
	db, err = sql.Open("sqlite3", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %v", err)
	}

	// Create connections table if it doesn't exist
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS connections (
		id TEXT PRIMARY KEY,
		host TEXT NOT NULL,
		port TEXT NOT NULL,
		password TEXT,
		db INTEGER NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		return fmt.Errorf("failed to create table: %v", err)
	}

	return nil
}

func saveConnection(conn Connection) error {
	query := `
	INSERT OR REPLACE INTO connections (id, host, port, password, db)
	VALUES (?, ?, ?, ?, ?)`

	_, err := db.Exec(query, conn.ID, conn.Host, conn.Port, conn.Password, conn.DB)
	return err
}

func loadConnections() ([]Connection, error) {
	query := `SELECT id, host, port, password, db FROM connections`
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var connections []Connection
	for rows.Next() {
		var conn Connection
		err := rows.Scan(&conn.ID, &conn.Host, &conn.Port, &conn.Password, &conn.DB)
		if err != nil {
			return nil, err
		}
		connections = append(connections, conn)
	}

	return connections, nil
}

func deleteConnectionFromDB(id string) error {
	query := `DELETE FROM connections WHERE id = ?`
	_, err := db.Exec(query, id)
	return err
} 
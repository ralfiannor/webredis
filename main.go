package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

type RedisConnection struct {
	Host     string `json:"host"`
	Port     string `json:"port"`
	Password string `json:"password"`
	DB       int    `json:"db"`
}

var connections = make(map[string]*redis.Client)

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Load saved connections
	savedConnections, err := loadConnections()
	if err != nil {
		log.Printf("Warning: Failed to load saved connections: %v", err)
	} else {
		for _, conn := range savedConnections {
			options := &redis.Options{
				Addr: fmt.Sprintf("%s:%s", conn.Host, conn.Port),
				DB:   conn.DB,
			}
			if conn.Password != "" {
				options.Password = conn.Password
			}
			client := redis.NewClient(options)
			connections[conn.ID] = client
		}
	}

	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// API routes
	api := r.Group("/api")
	{
		api.POST("/connections", createConnection)
		api.GET("/connections", listConnections)
		api.DELETE("/connections/:id", deleteConnection)
		api.GET("/databases/:id", listDatabases)
		api.GET("/keys/:id/:db", listKeys)
		api.GET("/key/:id/:db/:key", getKey)
		api.POST("/key/:id/:db/:key", setKey)
		api.DELETE("/key/:id/:db/:key", deleteKey)
		api.POST("/execute/:id/:db", executeCommand)
	}

	// Serve static files - must be after API routes
	r.NoRoute(func(c *gin.Context) {
		c.File("./frontend/dist/index.html")
	})
	r.Static("/assets", "./frontend/dist/assets")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	r.Run(":" + port)
}

func createConnection(c *gin.Context) {
	var conn RedisConnection
	if err := c.ShouldBindJSON(&conn); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	options := &redis.Options{
		Addr: fmt.Sprintf("%s:%s", conn.Host, conn.Port),
		DB:   conn.DB,
	}

	// Only set password if it's not empty
	if conn.Password != "" {
		options.Password = conn.Password
	}

	client := redis.NewClient(options)

	// Test connection
	if err := client.Ping(c).Err(); err != nil {
		log.Printf("Connection failed: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to connect to Redis"})
		return
	}

	connID := fmt.Sprintf("%s:%s", conn.Host, conn.Port)
	connections[connID] = client

	// Save connection to database
	dbConn := Connection{
		ID:       connID,
		Host:     conn.Host,
		Port:     conn.Port,
		Password: conn.Password,
		DB:       conn.DB,
	}
	if err := saveConnection(dbConn); err != nil {
		log.Printf("Warning: Failed to save connection to database: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{"id": connID})
}

func listConnections(c *gin.Context) {
	conns := make([]string, 0, len(connections))
	for id := range connections {
		conns = append(conns, id)
	}
	c.JSON(http.StatusOK, conns)
}

func deleteConnection(c *gin.Context) {
	id := c.Param("id")
	if client, exists := connections[id]; exists {
		client.Close()
		delete(connections, id)
		// Delete from database
		if err := deleteConnectionFromDB(id); err != nil {
			log.Printf("Warning: Failed to delete connection from database: %v", err)
		}
		c.Status(http.StatusOK)
		return
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "Connection not found"})
}

func listDatabases(c *gin.Context) {
	id := c.Param("id")
	_, exists := connections[id]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Connection not found"})
		return
	}

	dbs := make([]int, 0)
	for i := 0; i < 16; i++ { // Default Redis has 16 databases
		dbs = append(dbs, i)
	}

	c.JSON(http.StatusOK, dbs)
}

func listKeys(c *gin.Context) {
	id := c.Param("id")
	db := c.Param("db")
	client, exists := connections[id]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Connection not found"})
		return
	}

	// Select database
	if err := client.Do(c, "SELECT", db).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to select database: %v", err)})
		return
	}

	// Get all keys
	keys, err := client.Keys(c, "*").Result()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get TTL and type for each key
	keyInfo := make([]map[string]interface{}, len(keys))
	for i, key := range keys {
		ttl, err := client.TTL(c, key).Result()
		if err != nil {
			ttl = -2 // Error value
		}

		// Get key type
		keyType, err := client.Type(c, key).Result()
		if err != nil {
			keyType = "unknown"
		}

		keyInfo[i] = map[string]interface{}{
			"key":  key,
			"ttl":  ttl.Seconds(),
			"type": keyType,
		}
	}

	c.JSON(http.StatusOK, keyInfo)
}

func getKey(c *gin.Context) {
	id := c.Param("id")
	db := c.Param("db")
	key := c.Param("key")
	client, exists := connections[id]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Connection not found"})
		return
	}

	// Select database
	if err := client.Do(c, "SELECT", db).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to select database: %v", err)})
		return
	}

	// Get key type
	keyType, err := client.Type(c, key).Result()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var value interface{}
	switch keyType {
	case "string":
		val, err := client.Get(c, key).Result()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Try to parse as JSON first
		var jsonValue interface{}
		if err := json.Unmarshal([]byte(val), &jsonValue); err == nil {
			value = jsonValue
		} else {
			// If not JSON, check if it's binary data
			if isBinary(val) {
				value = map[string]interface{}{
					"type": "binary",
					"data": base64.StdEncoding.EncodeToString([]byte(val)),
				}
			} else {
				value = val
			}
		}
	case "list":
		val, err := client.LRange(c, key, 0, -1).Result()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Try to parse each item as JSON or handle binary data
		parsedList := make([]interface{}, len(val))
		for i, item := range val {
			var jsonValue interface{}
			if err := json.Unmarshal([]byte(item), &jsonValue); err == nil {
				parsedList[i] = jsonValue
			} else if isBinary(item) {
				parsedList[i] = map[string]interface{}{
					"type": "binary",
					"data": base64.StdEncoding.EncodeToString([]byte(item)),
				}
			} else {
				parsedList[i] = item
			}
		}
		value = parsedList
	case "set":
		val, err := client.SMembers(c, key).Result()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Try to parse each item as JSON or handle binary data
		parsedSet := make([]interface{}, len(val))
		for i, item := range val {
			var jsonValue interface{}
			if err := json.Unmarshal([]byte(item), &jsonValue); err == nil {
				parsedSet[i] = jsonValue
			} else if isBinary(item) {
				parsedSet[i] = map[string]interface{}{
					"type": "binary",
					"data": base64.StdEncoding.EncodeToString([]byte(item)),
				}
			} else {
				parsedSet[i] = item
			}
		}
		value = parsedSet
	case "hash":
		val, err := client.HGetAll(c, key).Result()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Try to parse each value as JSON or handle binary data
		parsedHash := make(map[string]interface{})
		for k, v := range val {
			var jsonValue interface{}
			if err := json.Unmarshal([]byte(v), &jsonValue); err == nil {
				parsedHash[k] = jsonValue
			} else if isBinary(v) {
				parsedHash[k] = map[string]interface{}{
					"type": "binary",
					"data": base64.StdEncoding.EncodeToString([]byte(v)),
				}
			} else {
				parsedHash[k] = v
			}
		}
		value = parsedHash
	case "zset":
		val, err := client.ZRangeWithScores(c, key, 0, -1).Result()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Convert to a more readable format and handle binary data
		zsetValue := make([]map[string]interface{}, len(val))
		for i, z := range val {
			memberStr := fmt.Sprintf("%v", z.Member)
			var jsonValue interface{}
			if err := json.Unmarshal([]byte(memberStr), &jsonValue); err == nil {
				zsetValue[i] = map[string]interface{}{
					"score":  z.Score,
					"member": jsonValue,
				}
			} else if isBinary(memberStr) {
				zsetValue[i] = map[string]interface{}{
					"score": z.Score,
					"member": map[string]interface{}{
						"type": "binary",
						"data": base64.StdEncoding.EncodeToString([]byte(memberStr)),
					},
				}
			} else {
				zsetValue[i] = map[string]interface{}{
					"score":  z.Score,
					"member": memberStr,
				}
			}
		}
		value = zsetValue
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported key type"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"type":  keyType,
		"value": value,
	})
}

// Helper function to check if a string contains binary data
func isBinary(s string) bool {
	for _, b := range []byte(s) {
		if b < 32 || b > 126 {
			return true
		}
	}
	return false
}

func setKey(c *gin.Context) {
	id := c.Param("id")
	db := c.Param("db")
	key := c.Param("key")
	client, exists := connections[id]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Connection not found"})
		return
	}

	// Select database
	if err := client.Do(c, "SELECT", db).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to select database: %v", err)})
		return
	}

	var data struct {
		Type  string      `json:"type"`
		Value interface{} `json:"value"`
		TTL   float64     `json:"ttl"` // Change to float64 to handle floating-point values
	}

	if err := c.ShouldBindJSON(&data); err != nil {
		log.Printf("Error binding JSON: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request data: %v", err)})
		return
	}

	// Convert TTL to integer seconds, ensuring non-negative value
	ttlSeconds := time.Duration(math.Max(0, math.Floor(data.TTL))) * time.Second

	var err error
	switch data.Type {
	case "string":
		// Try to convert the value to a string
		var strValue string
		switch v := data.Value.(type) {
		case string:
			strValue = v
		default:
			// Try to marshal non-string values to JSON
			jsonBytes, err := json.Marshal(v)
			if err != nil {
				log.Printf("Error marshaling value to JSON: %v", err)
				c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to convert value to string"})
				return
			}
			strValue = string(jsonBytes)
		}
		err = client.Set(c, key, strValue, ttlSeconds).Err()
	case "list":
		values := data.Value.([]interface{})
		// Delete existing list first
		if err := client.Del(c, key).Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clear existing list: %v", err)})
			return
		}
		for _, v := range values {
			err = client.RPush(c, key, v).Err()
			if err != nil {
				break
			}
		}
	case "set":
		values := data.Value.([]interface{})
		// Delete existing set first
		if err := client.Del(c, key).Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clear existing set: %v", err)})
			return
		}
		for _, v := range values {
			err = client.SAdd(c, key, v).Err()
			if err != nil {
				break
			}
		}
	case "hash":
		values := data.Value.(map[string]interface{})
		// Delete existing hash first
		if err := client.Del(c, key).Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clear existing hash: %v", err)})
			return
		}
		for k, v := range values {
			err = client.HSet(c, key, k, v).Err()
			if err != nil {
				break
			}
		}
	case "zset":
		values := data.Value.([]interface{})
		// Delete existing zset first
		if err := client.Del(c, key).Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clear existing zset: %v", err)})
			return
		}
		for _, v := range values {
			item := v.(map[string]interface{})
			err = client.ZAdd(c, key, redis.Z{
				Score:  item["score"].(float64),
				Member: item["member"],
			}).Err()
			if err != nil {
				break
			}
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported key type"})
		return
	}

	if err != nil {
		log.Printf("Error setting key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to set key: %v", err)})
		return
	}

	// Set TTL for non-string types
	if data.Type != "string" && ttlSeconds > 0 {
		err = client.Expire(c, key, ttlSeconds).Err()
		if err != nil {
			log.Printf("Error setting TTL: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to set TTL: %v", err)})
			return
		}
	}

	c.Status(http.StatusOK)
}

func deleteKey(c *gin.Context) {
	id := c.Param("id")
	db := c.Param("db")
	key := c.Param("key")
	client, exists := connections[id]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Connection not found"})
		return
	}

	// Select database
	if err := client.Do(c, "SELECT", db).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to select database: %v", err)})
		return
	}

	if err := client.Del(c, key).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func executeCommand(c *gin.Context) {
	id := c.Param("id")
	db := c.Param("db")
	client, exists := connections[id]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Connection not found"})
		return
	}

	// Select database
	if err := client.Do(c, "SELECT", db).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to select database: %v", err)})
		return
	}

	var data struct {
		Command string   `json:"command"`
		Args    []string `json:"args"`
	}

	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Convert args to interface{} for Redis command
	args := make([]interface{}, len(data.Args)+1)
	args[0] = data.Command
	for i, arg := range data.Args {
		args[i+1] = arg
	}

	// Execute command
	result, err := client.Do(c, args...).Result()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"result": result})
}
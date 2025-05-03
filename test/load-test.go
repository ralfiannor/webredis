package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/redis/go-redis/v9"
)

func main() {
	// Connect to Redis
	client := redis.NewClient(&redis.Options{
		Addr:     "localhost:6379",
		Password: "", // no password set
		DB:       0,  // use default DB
	})

	ctx := context.Background()

	// Test connection
	if err := client.Ping(ctx).Err(); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}

	// Clear existing keys
	if err := client.FlushDB(ctx).Err(); err != nil {
		log.Fatalf("Failed to flush database: %v", err)
	}

	// Generate and set keys
	totalKeys := 300000
	batchSize := 1000
	ttl := 60 * time.Hour

	// Create a pipeline for batch operations
	pipe := client.Pipeline()

	startTime := time.Now()
	for i := 0; i < totalKeys; i++ {
		// Generate keys with different patterns
		var key string
		switch rand.Intn(3) {
		case 0:
			key = fmt.Sprintf("test:key:%d", i)
		case 1:
			key = fmt.Sprintf("test:folder:%d:key:%d", i%10, i)
		case 2:
			key = fmt.Sprintf("other:key:%d", i)
		}

		// Generate a random value
		value := fmt.Sprintf("value-%d-%d", i, rand.Intn(1000000))

		// Add to pipeline
		pipe.Set(ctx, key, value, ttl)

		// Execute batch when it reaches batchSize
		if (i+1)%batchSize == 0 {
			_, err := pipe.Exec(ctx)
			if err != nil {
				log.Printf("Error executing batch %d: %v", (i+1)/batchSize, err)
			} else {
				log.Printf("Processed batch %d/%d", (i+1)/batchSize, totalKeys/batchSize)
			}
		}
	}

	// Execute any remaining commands
	if totalKeys%batchSize != 0 {
		_, err := pipe.Exec(ctx)
		if err != nil {
			log.Printf("Error executing final batch: %v", err)
		}
	}

	// Verify the number of keys
	keys, err := client.Keys(ctx, "*").Result()
	if err != nil {
		log.Printf("Error counting keys: %v", err)
	} else {
		log.Printf("Total keys in database: %d", len(keys))
	}

	elapsed := time.Since(startTime)
	log.Printf("Performance test completed in %v", elapsed)
	log.Printf("Average time per key: %v", elapsed/time.Duration(totalKeys))

	fmt.Println("\nNow run 'go run test/performance-test.go' to see the performance difference between SCAN and KEYS")
}

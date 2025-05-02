package main

import (
	"context"
	"fmt"
	"log"
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

	// Create context
	ctx := context.Background()

	// Test key patterns
	patterns := []string{
		"test:*",
		"test:folder:*",
		"*",
	}

	// Number of iterations for each test
	iterations := 100

	for _, pattern := range patterns {
		fmt.Printf("\nTesting pattern: %s\n", pattern)
		fmt.Println("----------------------------------------")

		// Test SCAN
		start := time.Now()
		for i := 0; i < iterations; i++ {
			_, _, err := client.Scan(ctx, 0, pattern, 100).Result()
			if err != nil {
				log.Printf("Error in SCAN: %v", err)
				continue
			}
		}
		scanDuration := time.Since(start)
		fmt.Printf("SCAN average time: %v\n", scanDuration/time.Duration(iterations))

		// Test KEYS
		start = time.Now()
		for i := 0; i < iterations; i++ {
			_, err := client.Keys(ctx, pattern).Result()
			if err != nil {
				log.Printf("Error in KEYS: %v", err)
				continue
			}
		}
		keysDuration := time.Since(start)
		fmt.Printf("KEYS average time: %v\n", keysDuration/time.Duration(iterations))

		// Calculate performance difference
		diff := float64(keysDuration-scanDuration) / float64(scanDuration) * 100
		fmt.Printf("SCAN is %.2f%% faster than KEYS\n", diff)
	}
} 
package models

import (
	"encoding/json"
	"time"
)

type BoardSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Tags      []string  `json:"tags"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Board struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Tags      []string        `json:"tags"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type CreateBoardRequest struct {
	Title string          `json:"title"`
	Tags  []string        `json:"tags"`
	Data  json.RawMessage `json:"data"`
}

type UpdateBoardRequest struct {
	Title *string          `json:"title,omitempty"`
	Tags  *[]string        `json:"tags,omitempty"`
	Data  *json.RawMessage `json:"data,omitempty"`
}

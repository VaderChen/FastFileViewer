package app

import (
	"context"
	"sync"
	"sync/atomic"
)

// entryRegistry 保存最近掃描到的項目，讓各服務都能用 ID 反查來源檔案。
type entryRegistry struct {
	mu      sync.Mutex
	entries map[string]ImageEntry
}

func newEntryRegistry() *entryRegistry {
	return &entryRegistry{entries: make(map[string]ImageEntry)}
}

func (r *entryRegistry) remember(entry ImageEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries[entry.ID] = entry
}

func (r *entryRegistry) lookup(entryID string) (ImageEntry, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.entries[entryID]
	return entry, ok
}

func (r *entryRegistry) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = make(map[string]ImageEntry)
}

type operationState struct {
	ctx    context.Context
	cancel context.CancelFunc
}

// operationRegistry 管理前端可取消的長時間操作，是跨服務共用的能力。
type operationRegistry struct {
	mu         sync.Mutex
	operations map[int64]operationState
	nextID     atomic.Int64
	parent     context.Context
}

func newOperationRegistry() *operationRegistry {
	return &operationRegistry{operations: make(map[int64]operationState)}
}

// adopt 會把應用程式的生命週期 context 設為之後所有操作的父節點。
func (r *operationRegistry) adopt(parent context.Context) {
	r.mu.Lock()
	r.parent = parent
	r.mu.Unlock()
}

func (r *operationRegistry) begin() int64 {
	operationID := r.nextID.Add(1)
	r.mu.Lock()
	parent := r.parent
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	r.operations[operationID] = operationState{ctx: ctx, cancel: cancel}
	r.mu.Unlock()
	return operationID
}

func (r *operationRegistry) cancel(operationID int64) {
	r.mu.Lock()
	operation := r.operations[operationID]
	r.mu.Unlock()
	if operation.cancel != nil {
		operation.cancel()
	}
}

func (r *operationRegistry) finish(operationID int64) {
	r.mu.Lock()
	operation := r.operations[operationID]
	delete(r.operations, operationID)
	r.mu.Unlock()
	if operation.cancel != nil {
		operation.cancel()
	}
}

// context 會回傳操作的 context；找不到的操作視為已取消。
func (r *operationRegistry) context(operationID int64) context.Context {
	if operationID == 0 {
		return context.Background()
	}
	r.mu.Lock()
	operation, ok := r.operations[operationID]
	r.mu.Unlock()
	if !ok || operation.ctx == nil {
		ctx, stop := context.WithCancel(context.Background())
		stop()
		return ctx
	}
	return operation.ctx
}

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

// replace retires the previous path in the same critical section as publishing
// its replacement; a moved or renamed entry must not keep serving its old URL.
func (r *entryRegistry) replace(previousID string, entry ImageEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.entries, previousID)
	r.entries[entry.ID] = entry
}

func (r *entryRegistry) forget(entryID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.entries, entryID)
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
	stopParent context.CancelFunc
	closed     bool
}

func newOperationRegistry() *operationRegistry {
	parent, cancel := context.WithCancel(context.Background())
	return &operationRegistry{operations: make(map[int64]operationState), parent: parent, stopParent: cancel}
}

// adopt 會把應用程式的生命週期 context 設為之後所有操作的父節點。
func (r *operationRegistry) adopt(parent context.Context) {
	if parent == nil {
		parent = context.Background()
	}
	r.mu.Lock()
	previous := r.stopParent
	r.parent, r.stopParent = context.WithCancel(parent)
	r.closed = false
	r.operations = make(map[int64]operationState)
	r.mu.Unlock()
	if previous != nil {
		previous()
	}
}

// close 也取消不需要 UI 操作 ID 的讀取，並丟棄尚未 Finish 的狀態。
func (r *operationRegistry) close() {
	r.mu.Lock()
	r.closed = true
	cancel := r.stopParent
	r.operations = make(map[int64]operationState)
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (r *operationRegistry) begin() int64 {
	operationID := r.nextID.Add(1)
	r.mu.Lock()
	parent := r.parent
	if parent == nil {
		parent = context.Background()
	}
	if r.closed || parent.Err() != nil {
		r.mu.Unlock()
		return operationID
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
	r.mu.Lock()
	if operationID == 0 {
		parent := r.parent
		r.mu.Unlock()
		return parent
	}
	operation, ok := r.operations[operationID]
	r.mu.Unlock()
	if !ok || operation.ctx == nil {
		ctx, stop := context.WithCancel(context.Background())
		stop()
		return ctx
	}
	return operation.ctx
}

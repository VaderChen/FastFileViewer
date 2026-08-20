package app

type BootstrapPayload struct {
	DefaultPath        string   `json:"defaultPath"`
	SupportedImages    []string `json:"supportedImages"`
	SupportedDocuments []string `json:"supportedDocuments"`
	SupportedMedia     []string `json:"supportedMedia"`
	SupportedPacks     []string `json:"supportedPacks"`
}

type DirectoryScanResult struct {
	RootPath string       `json:"rootPath"`
	Node     *LibraryNode `json:"node"`
	Warnings []string     `json:"warnings"`
}

type LibraryNode struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Path     string        `json:"path"`
	Kind     string        `json:"kind"`
	Scanned  bool          `json:"scanned"`
	Images   []ImageEntry  `json:"images"`
	Children []LibraryNode `json:"children"`
}

type ImageEntry struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Path          string `json:"path"`
	DirectoryPath string `json:"directoryPath"`
	Source        string `json:"source"`
	ArchivePath   string `json:"archivePath,omitempty"`
	InnerPath     string `json:"innerPath,omitempty"`
	Format        string `json:"format"`
	Kind          string `json:"kind"`
	Size          int64  `json:"size"`
}

type ImagePayload struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MIME     string `json:"mime"`
	DataURI  string `json:"dataUri"`
	Source   string `json:"source"`
	Location string `json:"location"`
}

type DocumentPayload struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Text     string `json:"text"`
	Format   string `json:"format"`
	Source   string `json:"source"`
	Location string `json:"location"`
}

type DuplicateGroup struct {
	Hash       string       `json:"hash"`
	TotalBytes int64        `json:"totalBytes"`
	Images     []ImageEntry `json:"images"`
}

type ExportResult struct {
	Destination string `json:"destination"`
	Exported    int    `json:"exported"`
	Skipped     int    `json:"skipped"`
}

type AppInfo struct {
	HardwareInfo string `json:"hardwareInfo"`
	OSVersion    string `json:"osVersion"`
	AppVersion   string `json:"appVersion"`
	Commit       string `json:"commit"`
	Tag          string `json:"tag"`
	BuildState   string `json:"buildState"`
	SourceURL    string `json:"sourceUrl"`
	License      string `json:"license"`
}

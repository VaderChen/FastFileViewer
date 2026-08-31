package app

type BootstrapPayload struct {
	DefaultPath        string   `json:"defaultPath"`
	SupportedImages    []string `json:"supportedImages"`
	SupportedDocuments []string `json:"supportedDocuments"`
	SupportedCode      []string `json:"supportedCode"`
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

// ImageMetadata contains lightweight image dimensions and commonly used EXIF fields.
type ImageMetadata struct {
	Width            int    `json:"width"`
	Height           int    `json:"height"`
	Orientation      string `json:"orientation,omitempty"`
	Make             string `json:"make,omitempty"`
	Model            string `json:"model,omitempty"`
	LensModel        string `json:"lensModel,omitempty"`
	DateTimeOriginal string `json:"dateTimeOriginal,omitempty"`
	ExposureTime     string `json:"exposureTime,omitempty"`
	FNumber          string `json:"fNumber,omitempty"`
	ISO              string `json:"iso,omitempty"`
	FocalLength      string `json:"focalLength,omitempty"`
	GPS              string `json:"gps,omitempty"`
	ColorModel       string `json:"colorModel,omitempty"`
}

// MediaMetadata contains stream and container information reported by ffprobe.
type MediaMetadata struct {
	Format        string `json:"format,omitempty"`
	Duration      string `json:"duration,omitempty"`
	BitRate       string `json:"bitRate,omitempty"`
	VideoCodec    string `json:"videoCodec,omitempty"`
	AudioCodec    string `json:"audioCodec,omitempty"`
	Width         int    `json:"width,omitempty"`
	Height        int    `json:"height,omitempty"`
	FrameRate     string `json:"frameRate,omitempty"`
	PixelFormat   string `json:"pixelFormat,omitempty"`
	SampleRate    string `json:"sampleRate,omitempty"`
	Channels      int    `json:"channels,omitempty"`
	ChannelLayout string `json:"channelLayout,omitempty"`
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

type FileOperationFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type TrashResult struct {
	RemovedIDs []string               `json:"removedIds"`
	Failed     []FileOperationFailure `json:"failed"`
}

type MoveResult struct {
	OriginalIDs map[string]string      `json:"originalIds"`
	Moved       []ImageEntry           `json:"moved"`
	Failed      []FileOperationFailure `json:"failed"`
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

type DownloadItem struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Status      string `json:"status"`
	ContentType string `json:"contentType"`
	Bytes       int64  `json:"bytes"`
	TotalBytes  int64  `json:"totalBytes"`
	Error       string `json:"error,omitempty"`
	CreatedAt   int64  `json:"createdAt"`
	CompletedAt int64  `json:"completedAt,omitempty"`
}

type HLSCandidate struct {
	URL  string `json:"url"`
	Name string `json:"name"`
}

type DownloadResolution struct {
	SourceURL  string         `json:"sourceUrl"`
	Name       string         `json:"name"`
	Candidates []HLSCandidate `json:"candidates"`
}

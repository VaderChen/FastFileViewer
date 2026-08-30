package main

import (
	"context"
	"embed"
	"log"
	"os"
	"strings"

	"github.com/VaderChen/FastFileViewer/internal/app"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	services := app.New()
	// 直接由 Finder／`open` 傳入檔案時，macOS 會將路徑放在 argv；
	// 先排入佇列可讓前端完成第一幀後立即開啟，不必等待 OnFileOpen Apple Event。
	for _, argument := range os.Args[1:] {
		if strings.TrimSpace(argument) == "" || strings.HasPrefix(argument, "-") {
			continue
		}
		services.Library.QueueOpenFile(argument)
	}

	err := wails.Run(&options.App{
		Title:       "FastFileViewer",
		Width:       1440,
		Height:      920,
		MinWidth:    960,
		MinHeight:   560,
		AssetServer: &assetserver.Options{Assets: assets, Middleware: app.NewMediaMiddleware(services.Media)},
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true},
		Mac: &mac.Options{
			OnFileOpen: services.Library.QueueOpenFile,
		},
		BackgroundColour: &options.RGBA{R: 242, G: 244, B: 241, A: 1},
		OnStartup:        services.Startup,
		OnShutdown: func(context.Context) {
			services.Shutdown()
		},
		Bind: []interface{}{
			services.Library,
			services.Media,
			services.Download,
			services.File,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

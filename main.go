package main

import (
	"context"
	"embed"
	"log"

	"github.com/VaderChen/FastFileViewer/internal/app"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	services := app.New()

	err := wails.Run(&options.App{
		Title:            "FastFileViewer",
		Width:            1440,
		Height:           920,
		MinWidth:         960,
		MinHeight:        560,
		AssetServer:      &assetserver.Options{Assets: assets, Middleware: app.NewMediaMiddleware(services.Media)},
		DragAndDrop:      &options.DragAndDrop{EnableFileDrop: true},
		BackgroundColour: &options.RGBA{R: 242, G: 244, B: 241, A: 1},
		OnStartup:        services.Startup,
		OnShutdown: func(context.Context) {
			services.Shutdown()
		},
		Bind: []interface{}{
			services.Library,
			services.Media,
			services.Download,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

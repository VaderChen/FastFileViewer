//go:build !darwin

package updater

import (
	"context"
	"errors"
)

func Capability(context.Context) error { return errors.New("unsupported") }
func Prepare(context.Context, *Client, Release, string, func(string, int64)) (string, func(), error) {
	return "", func() {}, errors.New("unsupported")
}
func LaunchInstaller(context.Context, string) error { return errors.New("unsupported") }
func RunInstaller([]string) (bool, error)           { return false, nil }
func AcknowledgeLaunch([]string)                    {}

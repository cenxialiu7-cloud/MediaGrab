// MediaGrab Windows launcher — spawns node.exe hidden + opens the default browser.
// Compiled with -H windowsgui so it has no console window of its own.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const port = "9800"

func main() {
	exePath, err := os.Executable()
	if err != nil {
		fatal("Cannot resolve executable path: " + err.Error())
	}
	appDir := filepath.Dir(exePath)
	nodeExe := filepath.Join(appDir, "node", "node.exe")
	serverDir := filepath.Join(appDir, "app")
	serverJs := filepath.Join(serverDir, "server", "index.js")
	binDir := filepath.Join(appDir, "bin")
	browsersDir := filepath.Join(appDir, "ms-playwright")

	userData := filepath.Join(os.Getenv("LOCALAPPDATA"), "MediaGrab")
	_ = os.MkdirAll(userData, 0755)
	logPath := filepath.Join(userData, "server.log")
	pidPath := filepath.Join(userData, "server.pid")

	// Already running on the port? Decide reuse vs. update-takeover.
	if pingServer() {
		myVer := readVersion(filepath.Join(serverDir, "package.json"))
		if running := runningVersion(); myVer != "" && running == myVer {
			// Same version already running — just open the browser to it.
			openBrowser("http://localhost:" + port)
			return
		}
		// Older/unknown instance holds the port (e.g. you just updated) — ask it
		// to quit, then wait for the port to free so this version takes over.
		http.Post("http://localhost:"+port+"/api/quit", "application/json", nil)
		for i := 0; i < 30; i++ {
			if !pingServer() {
				break
			}
			time.Sleep(300 * time.Millisecond)
		}
		// Last resort (e.g. an old build with no /api/quit still holding the
		// port): force-stop the recorded server process so the update can start.
		if pingServer() {
			if b, err := os.ReadFile(pidPath); err == nil {
				exec.Command("taskkill", "/PID", strings.TrimSpace(string(b)), "/F").Run()
				for i := 0; i < 20; i++ {
					if !pingServer() {
						break
					}
					time.Sleep(300 * time.Millisecond)
				}
			}
		}
	}

	// Build env for child Node process
	env := os.Environ()
	env = setEnv(env, "PATH", binDir+";"+os.Getenv("PATH"))
	env = setEnv(env, "PLAYWRIGHT_BROWSERS_PATH", browsersDir)
	env = setEnv(env, "NODE_ENV", "production")
	env = setEnv(env, "PORT", port)
	env = setEnv(env, "FFMPEG_LOCATION", binDir)

	cmd := exec.Command(nodeExe, serverJs)
	cmd.Dir = serverDir
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}

	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if logFile != nil {
		defer logFile.Close()
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		fmt.Fprintf(logFile, "\n--- MediaGrab launcher started at %s ---\n", time.Now().Format(time.RFC3339))
	}

	if err := cmd.Start(); err != nil {
		fatal("Failed to start Node server: " + err.Error())
	}

	_ = os.WriteFile(pidPath, []byte(fmt.Sprintf("%d", cmd.Process.Pid)), 0644)

	// Wait up to ~15 seconds for server to respond
	for i := 0; i < 30; i++ {
		if pingServer() {
			openBrowser("http://localhost:" + port)
			return
		}
		time.Sleep(500 * time.Millisecond)
	}

	// Server didn't come up — open browser anyway and the user-data folder
	openBrowser("http://localhost:" + port)
	exec.Command("explorer", userData).Start()
}

func pingServer() bool {
	client := http.Client{Timeout: 800 * time.Millisecond}
	resp, err := client.Get("http://localhost:" + port + "/api/status")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

// runningVersion returns the version reported by an instance already on the port
// (empty if none / unreadable / an older build that doesn't report a version).
func runningVersion() string {
	client := http.Client{Timeout: 800 * time.Millisecond}
	resp, err := client.Get("http://localhost:" + port + "/api/status")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return ""
	}
	var data struct {
		Version string `json:"version"`
	}
	json.NewDecoder(resp.Body).Decode(&data)
	return data.Version
}

func readVersion(pkgPath string) string {
	b, err := os.ReadFile(pkgPath)
	if err != nil {
		return ""
	}
	var data struct {
		Version string `json:"version"`
	}
	json.Unmarshal(b, &data)
	return data.Version
}

func openBrowser(url string) {
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func setEnv(env []string, key, value string) []string {
	prefix := strings.ToUpper(key) + "="
	for i, e := range env {
		if strings.HasPrefix(strings.ToUpper(e), prefix) {
			env[i] = key + "=" + value
			return env
		}
	}
	return append(env, key+"="+value)
}

func fatal(msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	mb := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString("MediaGrab")
	body, _ := syscall.UTF16PtrFromString(msg)
	mb.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x10)
	os.Exit(1)
}

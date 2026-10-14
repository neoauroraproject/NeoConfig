package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"gopkg.in/yaml.v3"
)

const version = "1.0.0"

type config struct {
	APIBaseURL  string `yaml:"api_base_url"`
	ServerID    string `yaml:"server_id"`
	AgentSecret string `yaml:"agent_secret"`
}

func main() {
	enroll := flag.Bool("enroll", false, "redeem enrollment token")
	token := flag.String("token", "", "one-time enrollment token")
	apiURL := flag.String("api-url", "", "API base URL for enrollment (e.g. https://app.example.com)")
	configPath := flag.String("config", "/etc/neoconfig/agent.yaml", "config path")
	once := flag.Bool("once", false, "send a single heartbeat and exit")
	flag.Parse()

	if *enroll {
		if err := runEnroll(*token, *apiURL, *configPath); err != nil {
			fmt.Fprintf(os.Stderr, "enroll failed: %v\n", err)
			os.Exit(1)
		}
		return
	}

	cfg, err := loadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(1)
	}

	hostname, _ := os.Hostname()
	if *once {
		if err := heartbeat(cfg, hostname); err != nil {
			fmt.Fprintf(os.Stderr, "heartbeat failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("heartbeat ok")
		return
	}

	fmt.Printf("neoconfig-agent %s starting (server=%s)\n", version, cfg.ServerID)
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	backoff := time.Second
	for {
		if err := heartbeat(cfg, hostname); err != nil {
			fmt.Fprintf(os.Stderr, "heartbeat error: %v\n", err)
			time.Sleep(backoff)
			if backoff < 5*time.Minute {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		<-ticker.C
	}
}

func runEnroll(token, apiURL, configPath string) error {
	if token == "" {
		return fmt.Errorf("missing --token")
	}
	if apiURL == "" {
		return fmt.Errorf("missing --api-url")
	}
	hostname, _ := os.Hostname()
	body := map[string]string{
		"token":        token,
		"hostname":     hostname,
		"agentVersion": version,
	}
	raw, _ := json.Marshal(body)
	endpoint := trimSlash(apiURL) + "/api/v1/agent/enroll"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "neoconfig-agent/"+version)

	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("enroll HTTP %d: %s", res.StatusCode, string(data))
	}

	var out struct {
		ServerID                string `json:"serverId"`
		AgentSecret             string `json:"agentSecret"`
		APIBaseURL              string `json:"apiBaseUrl"`
		HeartbeatIntervalSeconds int   `json:"heartbeatIntervalSeconds"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return err
	}

	cfg := config{
		APIBaseURL:  out.APIBaseURL,
		ServerID:    out.ServerID,
		AgentSecret: out.AgentSecret,
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		return err
	}
	b, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := os.WriteFile(configPath, b, 0o600); err != nil {
		return err
	}
	fmt.Printf("Enrolled server %s (%s/%s). Config written to %s\n", out.ServerID, runtime.GOOS, runtime.GOARCH, configPath)
	return nil
}

func loadConfig(path string) (*config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg config
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return nil, err
	}
	if cfg.APIBaseURL == "" || cfg.ServerID == "" || cfg.AgentSecret == "" {
		return nil, fmt.Errorf("incomplete config")
	}
	return &cfg, nil
}

func heartbeat(cfg *config, hostname string) error {
	body := map[string]string{
		"serverId":     cfg.ServerID,
		"agentSecret":  cfg.AgentSecret,
		"agentVersion": version,
		"hostname":     hostname,
	}
	raw, _ := json.Marshal(body)
	endpoint := trimSlash(cfg.APIBaseURL) + "/heartbeat"
	// api_base_url already includes /api/v1/agent
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "neoconfig-agent/"+version)
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
	if res.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return nil
}

func trimSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}

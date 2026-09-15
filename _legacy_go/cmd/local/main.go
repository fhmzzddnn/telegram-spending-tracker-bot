package main

import (
	"log"
	"net/http"
	"os"

	"money-bot/pkg/bot"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

func main() {
	token := os.Getenv("BOT_TOKEN")
	baseURL := os.Getenv("BASE_URL") // The Cloudflare/Tunnel URL
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if token == "" || baseURL == "" {
		log.Fatal("BOT_TOKEN and BASE_URL are required")
	}

	b, err := tgbotapi.NewBotAPI(token)
	if err != nil {
		log.Panic(err)
	}

	webhookConfig, err := tgbotapi.NewWebhook(baseURL + "/webhook")
	if err != nil {
		log.Fatal(err)
	}

	_, err = b.Request(webhookConfig)
	if err != nil {
		log.Fatal(err)
	}

	info, err := b.GetWebhookInfo()
	if err != nil {
		log.Fatal(err)
	}

	if info.LastErrorDate != 0 {
		log.Printf("Telegram callback failed: %s", info.LastErrorMessage)
	}

	http.HandleFunc("/webhook", bot.HandleTelegramWebhook)
	http.HandleFunc("/", bot.HealthCheck)

	log.Printf("Starting server on port %s...", port)
	log.Printf("Webhook set to %s/webhook", baseURL)

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}

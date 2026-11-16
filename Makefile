.PHONY: build dev

build:
	pnpm --dir web install --frozen-lockfile
	pnpm --dir web run build
	go build -o fitools .

dev:
	pnpm --dir web run dev

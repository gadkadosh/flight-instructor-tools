.PHONY: build install build-web dev

build: build-web
	go build -o fitools .

install: build-web
	go install .

build-web:
	pnpm --dir web install --frozen-lockfile
	pnpm --dir web run build

dev:
	pnpm --dir web run dev

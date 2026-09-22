import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	cacheComponents: true,
	partialPrefetching: true,
	output: "standalone",
	transpilePackages: ["@stellar-scaffold/app-lib"],
	async rewrites() {
		return [{ source: "/friendbot", destination: "http://localhost:8000/friendbot" }]
	},
}

export default nextConfig

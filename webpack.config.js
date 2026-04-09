var webpack = require("webpack"),
  path = require("path"),
  env = require("./utils/env"),
  CopyWebpackPlugin = require("copy-webpack-plugin"),
  HtmlWebpackPlugin = require("html-webpack-plugin"),
  TerserPlugin = require("terser-webpack-plugin");
var { CleanWebpackPlugin } = require("clean-webpack-plugin");

const ASSET_PATH = process.env.ASSET_PATH || "/";

var fileExtensions = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "eot",
  "otf",
  "svg",
  "ttf",
  "woff",
  "woff2",
];

const isDevelopment = process.env.NODE_ENV !== "production";

// ---------------------------------------------------------------------------
// Browser target: "chrome" (default) or "firefox"
// ---------------------------------------------------------------------------
const BROWSER = process.env.BROWSER || "chrome";
const isFirefox = BROWSER === "firefox";
const isChrome = BROWSER === "chrome";

// Environment-specific config for CSTRADEUP
const ENV_CONFIG = {
  development: {
    HOSTNAME: "http://localhost:3000",
    DOMAIN: "localhost",
  },
  production: {
    HOSTNAME: "https://cstradeup.net",
    DOMAIN: "cstradeup.net",
  },
};
const currentEnv = isDevelopment ? ENV_CONFIG.development : ENV_CONFIG.production;

var options = {
  mode: process.env.NODE_ENV || "development",
  ignoreWarnings: [
    /Circular dependency between chunks with runtime/,
    /ResizeObserver loop completed with undelivered notifications/,
    /Should not import the named export/,
    /Sass @import rules are deprecated and will be removed in Dart Sass 3.0.0/,
    /Global built-in functions are deprecated and will be removed in Dart Sass 3.0.0./,
    /repetitive deprecation warnings omitted/,
  ],

  entry: {
    popup: path.join(__dirname, "src", "popup.ts"),
    "service-worker": path.join(__dirname, "src", "background", "service-worker.ts"),
    content: path.join(__dirname, "src", "content", "content.ts"),
    "inject-api": path.join(__dirname, "src", "content", "inject-api.ts"),
    relay: path.join(__dirname, "src", "content", "relay.ts"),
    intercept: path.join(__dirname, "src", "content", "intercept.ts"),
    // Offscreen is used on both browsers:
    //   Chrome: loaded via chrome.offscreen.createDocument()
    //   Firefox: loaded directly in background_ff.html (background page)
    offscreen: path.join(__dirname, "src", "background", "offscreen", "offscreen.ts"),
  },
  // chromeExtensionBoilerplate: {
  //   notHotReload: ["background", "contentScript", "devtools"],
  // },
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "build"),
    clean: true,
    publicPath: ASSET_PATH,
  },
  module: {
    rules: [
      {
        // look for .css or .scss files
        test: /\.(css|scss)$/,
        // in the `src` directory
        use: [
          {
            loader: "style-loader",
          },
          {
            loader: "css-loader",
            options: { importLoaders: 1 },
          },
          {
            loader: "postcss-loader",
          },
          {
            loader: "sass-loader",
            options: {
              sourceMap: true,
              sassOptions: {
                silenceDeprecations: ["legacy-js-api"],
              }
            },
          },
        ],
      },
      {
        test: /\.html$/,
        loader: "html-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: require.resolve("ts-loader"),
            options: {
              transpileOnly: isDevelopment,
            },
          },
        ],
      },
      {
        test: /\.(js|jsx)$/,
        use: [
          {
            loader: "source-map-loader",
          },
          {
            loader: require.resolve("babel-loader"),
          },
        ],
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: fileExtensions
      .map((extension) => "." + extension)
      .concat([".js", ".jsx", ".ts", ".tsx", ".css"]),
  },
  plugins: [
    new CleanWebpackPlugin({ verbose: false }),
    new webpack.ProgressPlugin(),
    // expose and write the allowed env vars on the compiled bundle
    new webpack.EnvironmentPlugin(["NODE_ENV"]),
    new webpack.DefinePlugin({
      __CSTRADEUP_HOSTNAME__: JSON.stringify(currentEnv.HOSTNAME),
      __CSTRADEUP_DOMAIN__: JSON.stringify(currentEnv.DOMAIN),
      __IS_DEV__: JSON.stringify(isDevelopment),
      __BROWSER__: JSON.stringify(BROWSER),
    }),
    // new ExtReloader({
    //   manifest: path.resolve(__dirname, "src/manifest.json")
    // }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "src/manifest.json",
          to: path.join(__dirname, "build"),
          force: true,
          transform: function (content, path) {
            // generates the manifest file using the package.json informations
            const manifest = {
              description: process.env.npm_package_description,
              version: process.env.npm_package_version,
              ...JSON.parse(content.toString()),
            };

            if (!isDevelopment) {
              // Production: strip localhost patterns from manifest
              const stripLocalhost = (patterns) =>
                patterns.filter((p) => !p.includes("localhost") && !p.includes("://*/*"));

              if (manifest.content_scripts) {
                manifest.content_scripts = manifest.content_scripts.map((cs) => ({
                  ...cs,
                  matches: stripLocalhost(cs.matches),
                }));
              }
              if (manifest.host_permissions) {
                manifest.host_permissions = stripLocalhost(manifest.host_permissions);
              }
              if (manifest.externally_connectable?.matches) {
                manifest.externally_connectable.matches = stripLocalhost(
                  manifest.externally_connectable.matches
                );
              }
            }

            // ── Firefox-specific manifest transformations ──────────────────
            if (isFirefox) {
              // 1. Add gecko addon id (required for Firefox extensions)
              //    Override with FIREFOX_ADDON_ID env var or use default.
              manifest.browser_specific_settings = {
                gecko: {
                  id: process.env.FIREFOX_ADDON_ID || "extension@cstradeup.net",
                  strict_min_version: "128.0",
                },
              };

              // 2. Firefox MV3 uses background.scripts (not service_worker).
              //    Firefox creates an auto-generated background page and loads
              //    each script via <script> tags.  We include both the main
              //    background script AND the offscreen bundle so the WASM/Worker
              //    notarization code runs in the same context — no offscreen API needed.
              manifest.background = {
                scripts: [
                  manifest.background?.service_worker || "service-worker.bundle.js",
                  "offscreen.bundle.js",
                ],
              };

              // 3. Remove Chrome-only permissions
              if (manifest.permissions) {
                const chromeOnlyPerms = ["offscreen"];
                manifest.permissions = manifest.permissions.filter(
                  (p) => !chromeOnlyPerms.includes(p)
                );
              }

              // 4. externally_connectable is not supported in Firefox
              delete manifest.externally_connectable;
            }

            return Buffer.from(JSON.stringify(manifest, null, 2));
          },
        },
      ],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "styles.css",
          to: path.join(__dirname, "build"),
          force: true,
        },
      ],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "src/icon128.png",
          to: path.join(__dirname, "build"),
          force: true,
        },
      ],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "node_modules/tlsn-js/build",
          to: path.join(__dirname, "build"),
          force: true,
        },
      ],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.join(__dirname, "src", "popup.html"),
          to: path.join(__dirname, "build"),
        },
      ],
    }),
    // Chrome needs offscreen.html for the chrome.offscreen API;
    // Firefox loads offscreen.bundle.js directly via background.scripts.
    isChrome &&
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.join(__dirname, "src", "background", "offscreen", "offscreen.html"),
            to: path.join(__dirname, "build"),
          },
        ],
      }),
    /* new HtmlWebpackPlugin({
      template: path.join(__dirname, "src", "popup.html"),
      filename: "popup.html",
      chunks: ["popup"],
      cache: false,
      inject: false,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, "src", "background", "offscreen", "offscreen.html"),
      filename: "offscreen.html",
      chunks: ["offscreen"],
      cache: false,
      inject: false,
    }), */
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
  ].filter(Boolean),
  infrastructureLogging: {
    level: "info",
  },
  // Required by wasm-bindgen-rayon, in order to use SharedArrayBuffer on the Web
  // Ref:
  //  - https://github.com/GoogleChromeLabs/wasm-bindgen-rayon#setting-up
  //  - https://web.dev/i18n/en/coop-coep/
  devServer: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
};

if (env.NODE_ENV === "development") {
  options.devtool = "cheap-module-source-map";
} else {
  options.optimization = {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
      }),
    ],
  };
}

module.exports = options;

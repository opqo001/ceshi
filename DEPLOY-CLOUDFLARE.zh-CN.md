# Cloudflare Workers + R2 完整部署指南

本项目已转换为英文的 Cloudflare Worker 网站：前台提交预约，Worker 校验后写入 R2，登录后台查看。地图继续使用单个 Google 内嵌窗口，无需 Google API Key。指定的地图说明段落已移除。

当前交付是可上传 GitHub 的完整项目包；尚未连接或部署到你的 Cloudflare 账户。

## 1. 上传 GitHub 的文件结构

解压后进入 `cloudflare-worker`，把**这个文件夹中的内容**上传到 GitHub 仓库根目录。根目录应能直接看到：

```text
package.json
package-lock.json
wrangler.jsonc
src/worker.js
public/index.html
public/booking.html
public/admin/index.html
public/admin/login.html
public/css/styles.css
public/css/admin.css
public/js/script.js
public/js/address-maps.js
public/js/admin.js
public/images/london-moving-background.png
public/images/family.svg
public/images/office.svg
public/images/packing.svg
scripts/
tests/
README.md
DEPLOY-CLOUDFLARE.zh-CN.md
.gitignore
.dev.vars.example
```

不要上传 `node_modules`、`.wrangler`、`.dev.vars`。交付 ZIP 已排除这些目录、实际会话密钥和本地测试预约。

如果你保留外层文件夹，使仓库内容位于 `cloudflare-worker/` 子目录，后续 Cloudflare 的 Root directory 填 `cloudflare-worker`；如果上传的是文件夹内的内容，Root directory 留空。

**不要只复制 worker.js 到 Cloudflare 在线编辑器。**本项目需要把 `public` 中的静态资源一起部署，推荐下方的 GitHub 连接方式。

## 2. 新建私有 R2 Bucket

1. 登录 Cloudflare Dashboard，进入 **Storage & databases → R2 object storage**；有些界面直接显示 **R2**。
2. 点击 **Create bucket**。
3. Bucket name 填 `warm-moving-bookings`。
4. Location 选择默认的 **Automatic**；Storage class 选择 **Standard**。
5. 创建 Bucket。
6. 保持 **Public access / r2.dev / Custom domain 全部未启用**。这个 Bucket 存放客户电话和地址，不需要公开访问。
7. 不需要配置 Bucket CORS，不需要创建 S3 Access Key，也不需要填写公开的 R2 文件地址。浏览器通过 Worker API 提交，Worker 在服务端通过绑定访问 R2。

如果你已有其他 Bucket，可以复用，但必须把 `wrangler.jsonc` 中的 `r2_buckets[0].bucket_name` 改成实际名称。推荐使用独立的预约 Bucket。

预约将写入 `bookings/` 前缀，每条预约一个 JSON 对象。目录会在第一次成功提交后自动出现，不需要手动建文件夹或数据库表。

官方参考：[新建 R2 Bucket](https://developers.cloudflare.com/r2/buckets/create-buckets/)、[在 Worker 使用 R2](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)。

## 3. 用 GitHub 部署到 Workers

1. 进入 **Workers & Pages**。
2. 点击 **Create application / Create Worker**，选择 **Import a repository / Connect Git** 一类的 Git 导入入口；选择部署 **Worker**，不是单独的静态 Pages 项目。
3. 连接 GitHub，选择你上传代码的仓库和生产分支，例如 `main`。
4. Worker 名称使用 `warm-moving`。如果想换名字，先修改仓库中 `wrangler.jsonc` 的 `name`，并与 Cloudflare 创建的 Worker 名称保持一致。
5. 构建设置填写：

| 设置 | 填写值 |
| --- | --- |
| Root directory | 仓库根目录上传则留空；保留外层目录则填 `cloudflare-worker` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Production branch | 你的生产分支，例如 `main` |

本项目没有前端打包过程，`npm run build` 执行语法和文件引用检查；Wrangler 会自动打包 `src/worker.js` 并上传 `public`。

Cloudflare 应依据 `package-lock.json` 安装依赖。项目要求 Node.js 22 或以上，本次使用 Node.js 24 验证；如果构建日志提示 Node 版本过低，可在构建环境中设置受支持的较新 Node 版本。

6. 执行首次部署。R2 Bucket 必须已在同一 Cloudflare 账户中创建，否则部署会提示找不到 Bucket。
7. 部署后记录页面给出的真实 Worker 域名，例如 `https://warm-moving.<你的子域>.workers.dev`。本指南中的域名都是占位形式，不是已经创建的线上地址。

官方参考：[Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

## 4. 设置后台密码与会话密钥

进入这个 Worker 的 **Settings → Variables & Secrets**，添加两个 **运行时 Secret**：

| Type | Variable name | Value |
| --- | --- | --- |
| Secret | `ADMIN_PASSWORD` | `123` |
| Secret | `SESSION_SECRET` | 独立的随机字符串，至少 32 个字符，推荐 64 位十六进制 |

**不要把它们只加到 Settings → Build 的 Build variables and secrets 中。**构建环境变量不能代替 Worker 运行时 Secret。

生成 `SESSION_SECRET` 的任选方式：

项目已安装依赖时，在本地项目目录运行：

```sh
npm run secret:generate
```

复制生成的随机值到 Cloudflare 的 `SESSION_SECRET`。不要使用 `123` 作为这个签名密钥。

Windows PowerShell 也可直接生成：

```powershell
([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N'))
```

保存并部署配置。如果页面提示 **Deploy / Save and deploy**，执行该操作使 Secret 生效。

后台密码按要求为 `123`，没有用户名。这个密码较弱，正式公开使用时可以在 `ADMIN_PASSWORD` Secret 中替换；前端不需要改。修改密码会使已有后台会话失效。会话最长 8 小时。

官方参考：[Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

## 5. 检查新建绑定设置

项目中的 `wrangler.jsonc` 已声明绑定，正常通过 Wrangler/GitHub 部署后会自动应用。可以到 Worker 的 **Bindings** 页面确认：

| 绑定类型 | Variable name / 名称 | 对应资源 |
| --- | --- | --- |
| R2 bucket | `BOOKINGS` | `warm-moving-bookings` |
| Static Assets | `ASSETS` | 代码仓库的 `public` 目录 |
| Rate limit | `ADMIN_LOGIN_RATE_LIMITER` | 登录近似按节点/IP 5 次 / 60 秒 |
| Rate limit | `BOOKING_RATE_LIMITER` | 提交近似按节点/IP 10 次 / 60 秒 |

如果需要在界面手动补 R2 绑定：

1. 进入 Worker → **Bindings → Add binding**。
2. 选择 **R2 bucket**。
3. Variable name 必须填 **`BOOKINGS`**，大小写一致。
4. R2 bucket 选择 **`warm-moving-bookings`** 或你的实际 Bucket。
5. 保存并部署。
6. 同时确保仓库 `wrangler.jsonc` 中名称一致，以免下次 GitHub 部署覆盖手动配置。

关键配置如下，项目已填好：

```json
{
  "main": "src/worker.js",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "run_worker_first": true,
    "html_handling": "none",
    "not_found_handling": "none"
  },
  "r2_buckets": [
    {
      "binding": "BOOKINGS",
      "bucket_name": "warm-moving-bookings"
    }
  ]
}
```

`ASSETS` 由静态资源部署自动生成，不是需要你额外创建的 R2 Bucket。**不要移除 `run_worker_first: true`**：它使后台 HTML 和 API 请求先经过 Worker 的登录校验。

两个限流绑定也由 `wrangler.jsonc` 配置，不需要额外开通 KV、D1 或 Durable Objects。若账户中其他项目已使用相同的限流 namespace ID，可以在配置文件中换成各不相同的数字字符串。

官方参考：[静态资源绑定](https://developers.cloudflare.com/workers/static-assets/binding/)、[R2 Worker 绑定](https://developers.cloudflare.com/r2/get-started/workers-api/)、[Rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。

## 6. 前台与后台地址

假设 Cloudflare 给出的真实域名为 `https://warm-moving.<你的子域>.workers.dev`：

| 功能 | 地址 |
| --- | --- |
| 首页 | `https://warm-moving.<你的子域>.workers.dev/` |
| 预约页 | `https://warm-moving.<你的子域>.workers.dev/booking.html?service=family` |
| 后台登录与预约列表 | `https://warm-moving.<你的子域>.workers.dev/admin` |

登录后台输入 `123`。页面显示服务类型、预约日期、搬出地址、搬入地址、联系电话、提交时间和预约编号，按提交顺序从新到旧分页，每页 25 条。点击 **Load older requests** 查看较早记录。

后台数据接口 `/api/admin/bookings` 必须有有效登录会话；直接访问后台 HTML 路径也会经过校验。R2 中的对象不对访客直接公开。

## 7. 验证线上存储

1. 打开预约页，填写两个详细地址、日期与联系电话。
2. 点击 **Request a booking**。
3. 只有 R2 确认写入后，页面才会显示 **Booking received** 和预约编号。失败时页面显示英文错误，不会假报成功。
4. 打开 `/admin`，用密码 `123` 登录。
5. 应看到刚才的预约；已有后台页面可点击 **Refresh**。
6. 到 R2 Bucket → Objects → `bookings/`，应看到对应 JSON 文件，其中包含 `id`、`createdAt`、`service`、`fromAddress`、`toAddress`、`moveDate`、`phone`、`status`。
7. 退出后台后再直接打开 `/api/admin/bookings`，应收到未登录错误。

这里是“预约申请已收到”，并非自动承诺档期已确认。页面已用英文说明后续联系确认。当前没有自动邮件、短信或支付功能。

## 8. 替换 CSS、图片地址与英国电话

### 推荐：静态资源跟随 Worker 部署

CSS 已独立放在 `public/css/`，JavaScript 在 `public/js/`，图片在 `public/images/`。

直接在 GitHub 修改这些文件并提交，Cloudflare 会自动重新部署。它们使用同域相对路径，换 Worker 域名或绑定自定义域名后不需要逐个替换资源 URL。

背景图：`public/images/london-moving-background.png`。替换同名文件即可；改文件名时也要修改 `public/css/styles.css` 中的背景路径。

三张卡片图案：`public/images/family.svg`、`office.svg`、`packing.svg`。

### 可选：在 Worker 设置中统一替换外部 CSS/图片前缀

如果你想把 CSS、图片放在单独的 HTTPS 托管地址，项目支持运行时文本变量：

| Type | Name | Value |
| --- | --- | --- |
| Plaintext / Text | `ASSET_BASE_URL` | CSS 与 images 目录的共同 HTTPS 前缀 |

例如你把此项目的 `public` 文件夹发布到一个**公开、正确返回 CSS/图片 Content-Type 的 CDN**：

```text
https://cdn.example.com/warm-moving
```

则需要可访问：

```text
https://cdn.example.com/warm-moving/css/styles.css
https://cdn.example.com/warm-moving/css/admin.css
https://cdn.example.com/warm-moving/images/london-moving-background.png
https://cdn.example.com/warm-moving/images/family.svg
https://cdn.example.com/warm-moving/images/office.svg
https://cdn.example.com/warm-moving/images/packing.svg
```

在 Worker → **Settings → Variables & Secrets** 添加 `ASSET_BASE_URL`，保存部署即可。页面样式链接、静态图片与切换服务时加载的插画会统一使用该前缀；JS 和预约 API 仍由 Worker 同域提供。CSS 背景图按 `../images/` 相对解析，所以两类目录必须保持上述关系。

如果使用支持公开 GitHub 仓库的 CDN，可采用这类格式（OWNER、REPO、COMMIT 换成实际值）：

```text
https://cdn.jsdelivr.net/gh/OWNER/REPO@COMMIT/public
```

若仓库保留了 `cloudflare-worker` 外层目录，前缀末尾需要改成 `.../cloudflare-worker/public`。私有 GitHub 仓库不能直接作为这种公开 CDN 的来源。不要直接把返回 `text/plain` 的 GitHub 原始 CSS 地址当成样式表地址。

不填 `ASSET_BASE_URL` 即使用项目自带的同域资源；删除该变量可恢复。此变量只适用于公开 CSS/图片，**不应填写预约 R2 Bucket 的地址**。

### 电话

已替换为英国示例号码 **`+44 20 7946 0123`**，使用伦敦保留的示例号段，不是实际营业电话。请在以下两个文件替换显示号码及对应 `tel:` 链接：

- `public/index.html`
- `public/booking.html`

真实显示号码例如 `+44 ...`，`tel:` 链接使用去空格的国际号码。

号码参考：[Ofcom 保留示例号段](https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/numbers-for-drama)。

## 9. 本地预览与命令行部署（可选）

安装 Node.js 22 或以上，在项目目录执行：

```sh
npm ci
npm run setup:local
npm run dev
```

- 首页：`http://127.0.0.1:8787/`
- 后台：`http://127.0.0.1:8787/admin`
- 本地密码：`123`
- `setup:local` 会生成 `.dev.vars`，其中会话密钥是随机生成的。已有文件不会覆盖。
- 本地 R2 数据保存在 `.wrangler/`，不会写到线上 Bucket，也不会随 GitHub 上传。

本地检查：

```sh
npm run check
npm test
npx wrangler deploy --dry-run
```

在 `npm run dev` 仍运行的另一个终端中执行：

```sh
npm run test:integration
```

这会创建一条虚构的本地预约，验证真实本地 R2 读写、重试去重、后台授权，不会请求你的线上域名。

如果不用 GitHub 自动部署，命令行部署方式：

```sh
npx wrangler login
```

Bucket 尚不存在时再创建：

```sh
npx wrangler r2 bucket create warm-moving-bookings
```

部署代码与静态资源，然后按提示设置运行时 Secret：

```sh
npx wrangler deploy
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

第一个 Secret 输入 `123`，第二个输入独立随机密钥。`.dev.vars` 只用于本地，不会自动成为线上 Secret。

## 10. 常见问题

| 现象 | 检查项 |
| --- | --- |
| 部署提示 Bucket 不存在 | 先在同一账户创建 Bucket；检查 `bucket_name` 的拼写 |
| 后台提示未配置 | 检查运行时 `ADMIN_PASSWORD`、`SESSION_SECRET`；签名密钥至少 32 字符；保存后重新部署 |
| Secret 已填但仍无效 | 不要只填 Build variables；检查是否配在正确的生产 Worker 上 |
| 前台提交失败 | 查看 Worker Logs，确认 R2 绑定名为 `BOOKINGS`；代码不会记录客户原始表单 |
| 页面样式或图片缺失 | 确认完整 `public` 已上传；外部资源前缀是否有正确目录与 Content-Type |
| 后台一直跳回登录 | 允许网站 Cookie，使用同一域名；HTTPS 会话使用 Secure Cookie |
| 出现 Too many attempts | 等待至少一分钟再试；登录和预约都有限流 |
| Google 地图不显示 | 浏览器网络必须能访问 Google；地图失败不会清空表单或阻止预约保存 |
| 后台列表为空 | 确认看的是线上环境还是本地模拟环境；二者使用不同 R2 数据 |
| 请求过期 | 刷新并重新填写；提交引用用于网络重试去重，有有效期 |
| R2 里有记录但收到请求失败提示 | 原样重试可返回同一预约编号；不要先改表单，否则会被视为新的预约 |

生产分支之外的预览部署，请单独设置测试 R2 资源与 Secrets；不要误把测试预约写到生产 Bucket。

## 验证结果与交付范围

本地已通过：英文与资源路径检查、9 项后端测试、Worker dry-run、Cloudflare 本地 Worker + 原生 R2 预约写入与重复提交去重、浏览器提交后用 123 登录后台并看到预约记录。资源目录、GitHub 构建配置、绑定配置和部署说明均在项目中。

生产 Cloudflare Bucket、GitHub 仓库连接、运行时 Secrets 和真实域名需要按上文在你自己的账户中配置；当前未替你执行线上部署。

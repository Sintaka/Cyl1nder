# dsh-auto-mode

dsh-auto-mode 是 DeepSeek Harness 的 fail-closed 权限策略插件:它在每条工具调用执行前逐段检查命令与文件路径,自动放行日常开发操作,而对根目录、Home、DSH_HOME 及系统破坏、权限绕过、凭据外传等真正危险的操作直接拒绝或转为人工确认,在 Full access 的执行范围里补上"只拦最危险操作"的中间层。

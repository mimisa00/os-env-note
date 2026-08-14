export const PipelineGuard = async (ctx) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "bash") return
    if (/\|\s*(Select-Object\s+-First|Select-Object\s+-Last|Out-Host\s+-Paging|more)\b/i.test(output.args.command)) {
      throw new Error("改用: <command> *> build.log; Get-Content build.log -Tail 250")
    }
  },
})

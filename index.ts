import { serve } from "https://deno.land/std@0.177.1/http/server.ts"
import { getNewApprovalInstances } from "./getNewApprovalInstances.ts"

serve(async (req) => {
  const url = new URL(req.url)

  if (url.pathname === "/feishu/getNewApprovalInstances") {
    return await getNewApprovalInstances()
  }

  return new Response("Not Found", { status: 404 })
})

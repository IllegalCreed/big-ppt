import type { ToolDef } from '../registry.js'
import { buildListTemplatesPayload } from '../../routes/templates.js'

export const listTemplatesTool: ToolDef = {
  name: 'list_templates',
  description:
    '列出所有可用模板。返回每个模板的 manifest（id / name / description / layouts + 每个 layout 的 frontmatter schema / bodyGuidance / starterSlidesPath），以及 beitou-standard 的 usage_guide / design_spec / 可用图片路径。',
  parameters: { type: 'object', properties: {} },
  exec: async () => JSON.stringify(buildListTemplatesPayload()),
}

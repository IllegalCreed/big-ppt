export const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'read_slides',
      description: '读取当前 slides.md 的完整内容。在修改幻灯片之前，应先调用此工具了解当前内容。',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_slides',
      description:
        '用新内容完全替换 slides.md。仅在首次生成幻灯片时使用，修改已有内容请用 edit_slides。',
      parameters: {
        type: 'object' as const,
        properties: {
          content: {
            type: 'string' as const,
            description: '完整的 slides markdown 内容，包括 frontmatter 和所有页面',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_slides',
      description:
        '精确替换 slides.md 中的某段内容。old_string 必须是文件中唯一存在的文本片段，如果匹配到多处会报错，请提供更长的上下文以唯一定位。',
      parameters: {
        type: 'object' as const,
        properties: {
          old_string: {
            type: 'string' as const,
            description: '要被替换的原文，必须是文件中唯一匹配的文本',
          },
          new_string: {
            type: 'string' as const,
            description: '替换后的新内容',
          },
        },
        required: ['old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_template',
      description: '读取指定模板文件的 markdown 内容，用于了解模板的结构和语法。',
      parameters: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string' as const,
            description: '模板文件名，如 cover.md、toc.md、content.md',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_templates',
      description: '列出所有可用的页面模板，返回模板名称列表。',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
    },
  },
] as const

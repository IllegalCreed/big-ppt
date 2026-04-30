import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'ImageText',
  category: 'grid',
  description: '图文 45/55，可切左右；image prop 必填',
  propsOrSlots:
    'image: string / alt? / imageBorder?: "none"|"thin"|"thick" / direction?: "image-left"|"image-right"; slots: #text',
  example:
    '<ImageText image="/templates/X/y.png" direction="image-right"><template #text>说明</template></ImageText>',
  slotCapacity: 'medium',
}

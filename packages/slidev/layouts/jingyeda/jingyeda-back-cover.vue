<!--
  jingyeda-standard 封底 layout。
  结构：三段高度 3:5:2
    ① logo 段（3/10，右上 logo，与封面一致）
    ② 色块段（5/10，贴左右边 100% 宽，左蓝 2/3 + 右绿 1/3）
    ③ footer 段（2/10，右下网址）
  frontmatter 字段（全部可选，有默认值）：
    message : 主结束语（默认"谢 谢 ！"）
    orgZh   : 中文公司名（默认"竞 业 达 科 技"）
    orgEn   : 英文公司名（默认"JYD Technology"）
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    message?: string
    orgZh?: string
    orgEn?: string
  }>(),
  {
    message: '谢 谢 ！',
    orgZh: '竞 业 达 科 技',
    orgEn: 'JYD Technology',
  },
)
</script>

<template>
  <div class="slidev-layout jyd-back-cover-slide">
    <div class="jyd-bc-root">
      <!-- ① logo 段（3/10） -->
      <div class="jyd-bc-top">
        <img src="/templates/jingyeda-standard/logo.png" class="jyd-bc-logo" />
      </div>

      <!-- ② 色块段（5/10，贴 100% 宽：左蓝 2/3 + 右绿 1/3） -->
      <div class="jyd-bc-main">
        <div class="jyd-bc-blue">
          <div class="jyd-bc-message-wrap">
            <h1 class="jyd-bc-message">{{ message }}</h1>
          </div>
          <div v-if="orgZh || orgEn" class="jyd-bc-org-group">
            <p v-if="orgZh" class="jyd-bc-org-zh">{{ orgZh }}</p>
            <p v-if="orgEn" class="jyd-bc-org-en">{{ orgEn }}</p>
          </div>
        </div>
        <div class="jyd-bc-green"></div>
      </div>

      <!-- ③ footer 段（2/10） -->
      <div class="jyd-bc-footer">
        <span class="jyd-bc-url">www.jyd.com.cn</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jyd-bc-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  font-family: var(--jyd-ff-brand);
}

/* ① logo 段（跟封面一致：flex:3 + 右对齐 + padding 0 5% + logo 1.5em 高） */
.jyd-bc-top {
  flex: 3;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 0 5%;
}
.jyd-bc-logo {
  height: 1.5em;
}

/* ② 色块段：5/10 高，100% 宽（无 padding），左蓝 2/3 + 右绿 1/3 */
.jyd-bc-main {
  flex: 5;
  display: flex;
  align-items: stretch;
}
.jyd-bc-blue {
  flex: 2;  /* 2/3 */
  background: var(--jyd-brand-primary);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 2em 1.5em;  /* 顶部不 padding，底部留 1.5em 让 org 不贴到色块边缘 */
  box-sizing: border-box;
}
/* message 占上半部 flex:1 空间，内部居中 */
.jyd-bc-message-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.jyd-bc-message {
  color: #ffffff;
  font-size: 2em;
  font-weight: 500;
  letter-spacing: 0.4em;
  margin: 0;
  line-height: 1;
}
/* 公司名两行：包在固定宽度容器里贴底；两行都用 text-align-last: justify 强制等宽 */
.jyd-bc-org-group {
  width: 12em;
  flex-shrink: 0;
}
.jyd-bc-org-zh,
.jyd-bc-org-en {
  color: #ffffff;
  font-family: var(--jyd-ff-ui);
  margin: 0;
  line-height: 1.6;
  text-align: justify;
  text-align-last: justify;
  text-justify: inter-character;  /* 中文字符间自动均分，和 text-align-last 配合实现等宽 */
}
.jyd-bc-org-zh {
  font-size: 1.125em;
  font-weight: 500;
}
.jyd-bc-org-en {
  font-size: 0.75em;
  margin-top: 0.3em;
}
.jyd-bc-green {
  flex: 1;  /* 1/3 */
  background: var(--jyd-brand-accent);
}

/* ③ footer 段：右下网址 */
.jyd-bc-footer {
  flex: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 5%;
  font-family: var(--jyd-ff-ui);
}
.jyd-bc-url {
  color: var(--jyd-brand-primary);
  font-size: 0.75em;
  letter-spacing: 0.08em;
}
</style>

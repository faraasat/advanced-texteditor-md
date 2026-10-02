/**
 * `advanced-texteditor-md/comments`: inline comments anchored to text, with the threads stored by
 * the HOST. The Markdown holds only `[anchored text](comment:ID)`; any other renderer shows the
 * text (GitHub shows it as a link without a target).
 */
export { createCommentsPlugin, COMMENTS_LABELS } from "./plugin";
export type { CommentsOptions, CommentsPlugin, CommentsLabels, CommentSelection, CommentState, CommentOpenSource } from "./plugin";
export {
  COMMENT_NODE,
  COMMENT_BANG_NODE,
  COMMENT_SCHEME,
  COMMENT_ID_RE,
  isCommentId,
  commentPattern,
  commentSyntax,
  bangSyntax,
  commentSyntaxes,
  wrapComment,
  findComments,
  commentIds,
  removeCommentMarks,
} from "./syntax";
export type { CommentAnchor } from "./syntax";

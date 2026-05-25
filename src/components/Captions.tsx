type Props = {
  userText: string;
  assistantText: string;
  assistantName: string;
};

export function Captions({ userText, assistantText, assistantName }: Props) {
  return (
    <div className="captions">
      {userText && (
        <div className="caption-line">
          <span className="caption-speaker">You</span>
          {userText}
        </div>
      )}
      {assistantText && (
        <div className="caption-line">
          <span className="caption-speaker">{assistantName}</span>
          {assistantText}
        </div>
      )}
    </div>
  );
}

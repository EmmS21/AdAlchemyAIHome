import { useState, useEffect } from 'react';

const useTypingEffect = (text: string, speed: number) => {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        setDisplayedText((prev) => prev + text.charAt(i));
        i++;
      } else {
        clearInterval(timer);
      }
    }, speed);

    return () => {
      clearInterval(timer);
    };
  }, [text, speed]);

  return displayedText;
};

export default useTypingEffect;
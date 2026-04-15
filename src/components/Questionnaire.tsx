import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, ChevronLeft, ClipboardList } from 'lucide-react';
import { QUESTIONS } from '@/src/constants';
import { QuestionnaireScores } from '@/src/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { calculateQuestionnaireScores } from '@/src/services/geminiService';

interface QuestionnaireProps {
  onComplete: (scores: QuestionnaireScores, rawResponses: Record<string, string>) => void;
}

export default function Questionnaire({ onComplete }: QuestionnaireProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, string>>({});

  const currentQuestion = QUESTIONS[currentIndex];
  const progress = ((currentIndex + 1) / QUESTIONS.length) * 100;

  const handleSelect = (optionValue: string) => {
    const nextResponses = { ...responses, [currentQuestion.id]: optionValue };
    setResponses(nextResponses);

    if (currentIndex < QUESTIONS.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      return;
    }

    onComplete(calculateQuestionnaireScores(nextResponses), nextResponses);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto overflow-hidden border-zinc-800 bg-zinc-950 text-zinc-100">
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex justify-between items-center mb-2">
          <CardTitle className="flex items-center gap-2 text-xl font-light tracking-tight">
            <ClipboardList className="w-5 h-5 text-zinc-400" />
            설문 진단
          </CardTitle>
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
            {currentIndex + 1} / {QUESTIONS.length}
          </span>
        </div>
        <Progress value={progress} className="h-0.5 bg-zinc-800" />
      </CardHeader>
      <CardContent className="p-8 min-h-[420px] flex flex-col justify-between">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="space-y-8"
          >
            <div className="space-y-3">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.3em]">Questionnaire Signal</p>
              <h3 className="text-2xl font-light leading-tight text-zinc-200">{currentQuestion.text}</h3>
            </div>

            <div className="grid gap-3">
              {currentQuestion.options.map((option) => {
                const selected = responses[currentQuestion.id] === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    className={`group relative flex items-center justify-between p-5 rounded-xl border transition-all text-left active:scale-[0.98] ${
                      selected
                        ? 'border-zinc-500 bg-zinc-900 text-white'
                        : 'border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900 hover:border-zinc-700'
                    }`}
                  >
                    <span className="text-zinc-300 group-hover:text-white transition-colors">{option.label}</span>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 group-hover:translate-x-1 transition-all" />
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="flex justify-between items-center pt-8 border-t border-zinc-900">
          <Button
            variant="ghost"
            onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentIndex === 0}
            className="text-zinc-500 hover:text-zinc-300 hover:bg-transparent"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            이전
          </Button>
          <div className="flex gap-1">
            {QUESTIONS.map((question, index) => (
              <div
                key={question.id}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  index === currentIndex ? 'bg-zinc-400' : responses[question.id] ? 'bg-zinc-600' : 'bg-zinc-800'
                }`}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

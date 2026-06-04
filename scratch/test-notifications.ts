import { getTemplate } from '../src/modules/notification/notification-templates';

function testTemplates() {
  console.log('=== TESTING STREAK DANGER TEMPLATES ===');
  for (let i = 0; i < 5; i++) {
    const res = getTemplate('streak', { streak: 5, fullName: 'Aryan' });
    console.log(`[Streak] Title: "${res.title}" | Body: "${res.body}"`);
  }

  console.log('\n=== TESTING JEE MORNING TEMPLATES ===');
  for (let i = 0; i < 5; i++) {
    const res = getTemplate('morning', { examTarget: 'JEE', fullName: 'Rohan' });
    console.log(`[Morning JEE] Title: "${res.title}" | Body: "${res.body}"`);
  }

  console.log('\n=== TESTING NEET MORNING TEMPLATES ===');
  for (let i = 0; i < 5; i++) {
    const res = getTemplate('morning', { examTarget: 'NEET', fullName: 'Priya' });
    console.log(`[Morning NEET] Title: "${res.title}" | Body: "${res.body}"`);
  }

  console.log('\n=== TESTING BATTLE CHALLENGE TEMPLATES ===');
  for (let i = 0; i < 3; i++) {
    const res = getTemplate('battle_challenge', {
      challengerName: 'Amit',
      topicName: 'Rotational Mechanics',
    });
    console.log(`[Battle Challenge] Title: "${res.title}" | Body: "${res.body}"`);
  }

  console.log('\n=== TESTING OVERTAKE TEMPLATES ===');
  const res = getTemplate('overtake', { rivalName: 'Siddharth' });
  console.log(`[Overtake] Title: "${res.title}" | Body: "${res.body}"`);
}

testTemplates();

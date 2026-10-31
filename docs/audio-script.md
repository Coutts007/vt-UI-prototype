# Voice guidance script

**Status: OPEN.** The clips in `apps/web/public/audio/{en,sw}/` are placeholders made by a synthetic English voice. The Kiswahili clips are an English voice reading Kiswahili, so they are understandable at best. A native speaker must record every line below (decision D18). The Kiswahili text is an unreviewed draft.

To replace a clip, save it at the same path as `<key>.mp3`, 15 KB or less (mono, about 24 kbit/s). To change the words, edit `apps/web/src/capture/messages.json` and run `node scripts/audio-placeholders.mjs`, which regenerates the clips and this file.

| Key | English | Kiswahili (draft) |
|---|---|---|
| volume_test | This is the volume check. Can you hear me? | Hiki ni kipimo cha sauti. Unanisikia? |
| walk_away | Go and stand against the wall. Face the phone. | Nenda usimame karibu na ukuta. Uelekee simu. |
| n1 | One | Moja |
| n2 | Two | Mbili |
| n3 | Three | Tatu |
| n4 | Four | Nne |
| n5 | Five | Tano |
| good | Good | Vizuri |
| corr_tilt | The phone is tilted. Please straighten it. | Simu imeinama. Tafadhali inyooshe. |
| corr_step_in | I cannot see you. Stand in front of the phone. | Sikuoni. Simama mbele ya simu. |
| corr_head_cut | Your head or feet are cut off. Step back. | Kichwa au miguu haionekani. Rudi nyuma. |
| corr_too_far | Too far. Step forward one step. | Uko mbali sana. Sogea mbele hatua moja. |
| corr_too_close | Too close. Step back one step. | Uko karibu sana. Rudi nyuma hatua moja. |
| corr_turn_face | Turn to face the phone. | Geuka uelekee simu. |
| corr_turn_right | Turn a little more to your right. | Geuka kidogo zaidi kulia kwako. |
| corr_arms_away | Move your arm away from your body. | Weka mkono mbali na mwili wako. |
| corr_arms_forward | Let your arms hang a little forward. | Acha mikono ining'inie mbele kidogo. |
| corr_sheet_flat | Hold the sheet flat, black square facing the phone. | Shika karatasi vizuri, mraba mweusi uelekee simu. |
| corr_fingers | Move your fingers off the black square. | Toa vidole kwenye mraba mweusi. |
| corr_step_closer | Step a little closer. | Sogea karibu kidogo. |
| corr_too_dark | Too dark. Turn on a light or face a window. | Giza sana. Washa taa au uelekee dirisha. |
| corr_too_bright | Too bright behind you. Move away from the window. | Mwanga mwingi nyuma yako. Ondoka dirishani. |
| hold_still | Hold still. | Tulia. |
| done | Done. | Imekamilika. |
| turn_right | Turn to your right so your right shoulder faces the phone. Hold the sheet flat on your right hip. | Geuka kulia ili bega la kulia lielekee simu. Shika karatasi kwenye nyonga ya kulia. |
| try_again | Please hold still and try again. | Tafadhali tulia ujaribu tena. |
| finished | Finished. Walk back to the phone. | Imekwisha. Rudi kwenye simu. |
| help_1 | Wear fitted clothes. Have your measuring sheet ready. | Vaa nguo za kubana. Andaa karatasi ya kupimia. |
| help_2 | Stand the phone upright on a chair, then press start. | Simamisha simu kwenye kiti, kisha bonyeza anza. |
| help_3 | Stand three big steps away. Hold the sheet flat on your chest. | Simama hatua tatu kubwa. Shika karatasi kifuani. |
| help_4 | When asked, turn side on. Hold the sheet on your right hip. | Ukiambiwa, geuka ubavu. Shika karatasi kwenye nyonga ya kulia. |
| help_5 | Listen to the phone. It will tell you what to change. | Sikiliza simu. Itakuambia cha kubadilisha. |
